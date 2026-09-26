// Dastoori's side of the AI boundary (the external RAG engine itself is out
// of scope here): verification gate, atomic monthly cap, failure accounting,
// and the upstream deadline. A tiny local HTTP stub stands in for the
// upstream service so these paths run for real.
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as assistant } from '@/app/api/ai/assistant/route'
import { POST as legalSearch } from '@/app/api/search/legal/route'
import { POST as contractReview } from '@/app/api/ai/contract-review/route'
import { POST as caseAnalysis } from '@/app/api/ai/case-analysis/route'
import { POST as contractDraft } from '@/app/api/ai/contract-draft/route'
import { POST as draftExport } from '@/app/api/ai/contract-draft/export/route'
import { DEFAULT_MONTHLY_CAP, monthlyAiUsage } from '@/lib/ai/usage'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest } from './helpers'

const SERVICE_KEY = 'integration-stub-key'
const seenOfficeHeaders: string[] = []
let server: Server
let stalled: { destroy: () => void }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      if (req.headers['x-internal-service-key'] !== SERVICE_KEY) { res.writeHead(401).end(); return }
      seenOfficeHeaders.push(String(req.headers['x-dostoori-office-id']))
      const question = (() => { try { return JSON.parse(raw).question ?? '' } catch { return '' } })()
      if (question.includes('upstream-fail')) { res.writeHead(500).end('boom'); return }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (question.includes('upstream-stall')) {
        // Headers and a first frame, then silence: the body never finishes.
        res.write('event: delta\ndata: {"text":"partial"}\n\n')
        stalled.push(res.socket as unknown as { destroy: () => void })
        return
      }
      res.write('event: delta\ndata: {"text":"answer"}\n\n')
      res.end('event: done\ndata: {"grounded":true,"mode":"rag"}\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.AI_LEGAL_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.AI_LEGAL_SERVICE_KEY = SERVICE_KEY
})

const createdOffices: string[] = []
afterEach(() => {
  delete process.env.AI_LEGAL_SERVICE_TIMEOUT_MS
})
afterAll(async () => {
  stalled.forEach((s) => s.destroy())
  stalled = []
  await new Promise((resolve) => server.close(resolve))
  delete process.env.AI_LEGAL_SERVICE_URL
  delete process.env.AI_LEGAL_SERVICE_KEY
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function officeUser(opts: { emailVerified?: boolean } = {}) {
  const user = await createTestOfficeUser(opts)
  createdOffices.push(user.officeId)
  return user
}

const ask = (user: Awaited<ReturnType<typeof officeUser>>, message: string) =>
  assistant(testRequest('/api/ai/assistant', { method: 'POST', user, body: { message } }))

describe('AI endpoints require a verified email', () => {
  it('every AI route answers 403 email_not_verified for an unverified account (before any upstream call)', async () => {
    const user = await officeUser({ emailVerified: false })
    const before = seenOfficeHeaders.length
    const calls = [
      assistant(testRequest('/api/ai/assistant', { method: 'POST', user, body: { message: 'q' } })),
      legalSearch(testRequest('/api/search/legal', { method: 'POST', user, body: { question: 'q' } })),
      contractReview(testRequest('/api/ai/contract-review', { method: 'POST', user, body: { documentId: 'x' } })),
      caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user, body: { documentId: 'x' } })),
      contractDraft(testRequest('/api/ai/contract-draft', { method: 'POST', user, body: { notes: 'x'.repeat(40) } })),
      draftExport(testRequest('/api/ai/contract-draft/export', { method: 'POST', user, body: { draft: 'x' } })),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403)
      expect((await readJson(res)).code).toBe('email_not_verified')
    }
    expect(seenOfficeHeaders.length).toBe(before)
  })
})

describe('the monthly AI cap is atomic and counts only real usage', () => {
  it('10 concurrent calls with one slot left: exactly one succeeds, nine get 429', async () => {
    const user = await officeUser()
    await prisma.aiUsageLog.createMany({
      data: Array.from({ length: DEFAULT_MONTHLY_CAP - 1 }, () => ({
        officeId: user.officeId, userId: user.id, feature: 'assistant', model: 'seed', latencyMs: 1, success: true,
      })),
    })
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => ask(user, `question ${i}`)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 429)).toHaveLength(9)
    expect(await monthlyAiUsage(user.officeId)).toBe(DEFAULT_MONTHLY_CAP)
  })

  it('a failed upstream call is recorded but does not consume the office\'s quota', async () => {
    const user = await officeUser()
    const res = await ask(user, 'please upstream-fail')
    expect(res.status).toBe(502)
    expect(await monthlyAiUsage(user.officeId)).toBe(0)
    const row = await prisma.aiUsageLog.findFirstOrThrow({ where: { officeId: user.officeId } })
    expect(row.success).toBe(false)
    expect(row.errorCode).not.toBe('pending')
  })

  it('the upstream is told the caller\'s own office, from the server-side session', async () => {
    const user = await officeUser()
    seenOfficeHeaders.length = 0
    expect((await ask(user, 'which office?')).status).toBe(200)
    expect(seenOfficeHeaders).toEqual([user.officeId])
  })
})

describe('the upstream deadline covers the whole response', () => {
  it('an upstream that sends headers and then stalls ends in a 504 within the deadline (it used to hang forever)', async () => {
    process.env.AI_LEGAL_SERVICE_TIMEOUT_MS = '1500'
    const user = await officeUser()
    const started = Date.now()
    const res = await ask(user, 'upstream-stall')
    const elapsed = Date.now() - started
    expect(res.status).toBe(504)
    expect(elapsed).toBeLessThan(6000)
    // And the stalled attempt didn't eat quota.
    expect(await monthlyAiUsage(user.officeId)).toBe(0)
  })
})
