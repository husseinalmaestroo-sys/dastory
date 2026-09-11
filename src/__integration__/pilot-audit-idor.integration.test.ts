// 10-firm pilot security audit — Section 2 (multi-tenant isolation) + 19
// (data leakage), executed as an exhaustive IDOR matrix rather than the
// pairwise spot-checks in tenant-isolation.integration.test.ts. Extends that
// file's coverage to every resource type this session's authz-matrix lists
// as tenant-scoped, every mutating method (not just GET), the two
// document-specific side-channels (download, OCR, e-signature), the two
// AI routes that take a documentId (contract-review, case-analysis — a
// cross-office id here would mean the AI is fed another firm's document),
// and full-text search leaking another firm's client by name.
//
// Three offices, not two: B must be denied against A, and C must be denied
// against A, ruling out a pairwise coincidence in the WHERE clause. The
// underlying mechanism (officeId: user.officeId in every *VisibilityWhere
// helper, tenant-scope.ts) does not special-case which office is asking, so
// this generalizes to 10 firms / any N — it is not re-tested 10 times here
// because that would be redundant with the mechanism itself, not because
// scale wasn't considered (see pilot-audit-seed.ts for the actual 10-firm
// dataset, exercised by pilot-audit-db-integrity.integration.test.ts instead).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cleanupOffice, createTestOfficeUser, readJson, testParams, testRequest, type TestUser } from './helpers'

import { GET as caseGet, PATCH as casePatch, DELETE as caseDelete } from '@/app/api/cases/[id]/route'
import { GET as clientGet, PATCH as clientPatch, DELETE as clientDelete } from '@/app/api/clients/[id]/route'
import { PATCH as invoicePatch, DELETE as invoiceDelete } from '@/app/api/invoices/[id]/route'
import { PATCH as sessionPatch, DELETE as sessionDelete } from '@/app/api/sessions/[id]/route'
import { DELETE as documentDelete } from '@/app/api/documents/[id]/route'
import { GET as documentDownload } from '@/app/api/documents/[id]/download/route'
import { POST as documentOcr } from '@/app/api/documents/[id]/ocr/route'
import { GET as signHistory, POST as signDoc } from '@/app/api/documents/[id]/sign/route'
import { PATCH as timeEntryPatch, DELETE as timeEntryDelete } from '@/app/api/time-entries/[id]/route'
import { DELETE as calendarDelete } from '@/app/api/calendar-events/route'
import { GET as officeSearch } from '@/app/api/search/route'
import { POST as contractReview } from '@/app/api/ai/contract-review/route'
import { POST as caseAnalysis } from '@/app/api/ai/case-analysis/route'

type Fixture = {
  clientId: string
  caseId: string
  invoiceId: string
  sessionId: string
  timeEntryId: string
  calendarEventId: string
  documentId: string
}

const createdOffices: string[] = []
let firmA: TestUser
let firmB: TestUser
let firmC: TestUser
let dataA: Fixture

afterAll(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function firm(name: string): Promise<TestUser> {
  const user = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(user.officeId)
  await prisma.office.update({ where: { id: user.officeId }, data: { name } })
  return user
}

async function seedFullFixture(user: TestUser): Promise<Fixture> {
  const officeId = user.officeId
  const ownerId = user.id
  const client = await prisma.client.create({ data: { name: `${officeId} confidential client`, officeId, ownerId } })
  const kase = await prisma.case.create({
    data: { number: `AUDIT-${officeId.slice(-6)}`, title: 'Confidential case', type: 'مدني', officeId, clientId: client.id, ownerId },
  })
  const invoice = await prisma.invoice.create({
    data: { number: `AUDIT-INV-${officeId.slice(-6)}`, amount: 500, officeId, clientId: client.id, caseId: kase.id },
  })
  const session = await prisma.session.create({
    data: { date: new Date(), time: '10:00', court: 'محكمة بداية عمان', officeId, caseId: kase.id },
  })
  const timeEntry = await prisma.timeEntry.create({
    data: { officeId, userId: ownerId, caseId: kase.id, task: 'مراجعة ملف', minutes: 30 },
  })
  const calendarEvent = await prisma.calendarEvent.create({
    data: { title: 'جلسة سرية', date: new Date(), officeId, createdById: ownerId },
  })
  const document = await prisma.document.create({
    data: { name: 'confidential.pdf', type: 'PDF', officeId, ownerId, caseId: kase.id, url: `case-documents/${officeId}/${ownerId}/does-not-exist.pdf` },
  })
  return {
    clientId: client.id, caseId: kase.id, invoiceId: invoice.id, sessionId: session.id,
    timeEntryId: timeEntry.id, calendarEventId: calendarEvent.id, documentId: document.id,
  }
}

beforeAll(async () => {
  firmA = await firm('Firm-01 (victim)')
  firmB = await firm('Firm-02 (attacker)')
  firmC = await firm('Firm-03 (attacker)')
  dataA = await seedFullFixture(firmA)
})

const P = (id: string) => testParams({ id })

// Labels only, resolved to the real TestUser lazily INSIDE each test body
// via attacker() below. it.each's array argument is evaluated at collection
// time, before beforeAll runs — embedding firmB/firmC directly in the array
// literal would capture them while still undefined and silently turn every
// "attacker" call anonymous (401, not the 404 the test means to prove).
const ATTACKER_LABELS = ['Firm-02', 'Firm-03'] as const
function attacker(label: (typeof ATTACKER_LABELS)[number]): TestUser {
  return label === 'Firm-02' ? firmB : firmC
}

describe('IDOR matrix — every tenant-scoped resource, every mutating method, two independent attacker firms', () => {
  it.each(ATTACKER_LABELS)('%s cannot GET/PATCH/DELETE Firm-01\'s case', async (label) => {
    const user = attacker(label)
    expect((await caseGet(testRequest(`/api/cases/${dataA.caseId}`, { user }), P(dataA.caseId))).status).toBe(404)
    expect((await casePatch(testRequest(`/api/cases/${dataA.caseId}`, { method: 'PATCH', user, body: { title: 'pwned' } }), P(dataA.caseId))).status).toBe(404)
    expect((await caseDelete(testRequest(`/api/cases/${dataA.caseId}`, { method: 'DELETE', user }), P(dataA.caseId))).status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot GET/PATCH/DELETE Firm-01\'s client', async (label) => {
    const user = attacker(label)
    expect((await clientGet(testRequest(`/api/clients/${dataA.clientId}`, { user }), P(dataA.clientId))).status).toBe(404)
    expect((await clientPatch(testRequest(`/api/clients/${dataA.clientId}`, { method: 'PATCH', user, body: { name: 'pwned' } }), P(dataA.clientId))).status).toBe(404)
    expect((await clientDelete(testRequest(`/api/clients/${dataA.clientId}`, { method: 'DELETE', user }), P(dataA.clientId))).status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot PATCH/DELETE Firm-01\'s invoice', async (label) => {
    const user = attacker(label)
    expect((await invoicePatch(testRequest(`/api/invoices/${dataA.invoiceId}`, { method: 'PATCH', user, body: { notes: 'pwned' } }), P(dataA.invoiceId))).status).toBe(404)
    expect((await invoiceDelete(testRequest(`/api/invoices/${dataA.invoiceId}`, { method: 'DELETE', user }), P(dataA.invoiceId))).status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot PATCH/DELETE Firm-01\'s court session', async (label) => {
    const user = attacker(label)
    expect((await sessionPatch(testRequest(`/api/sessions/${dataA.sessionId}`, { method: 'PATCH', user, body: { notes: 'pwned' } }), P(dataA.sessionId))).status).toBe(404)
    expect((await sessionDelete(testRequest(`/api/sessions/${dataA.sessionId}`, { method: 'DELETE', user }), P(dataA.sessionId))).status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot PATCH/DELETE Firm-01\'s time entry', async (label) => {
    const user = attacker(label)
    expect((await timeEntryPatch(testRequest(`/api/time-entries/${dataA.timeEntryId}`, { method: 'PATCH', user, body: { minutes: 999 } }), P(dataA.timeEntryId))).status).toBe(404)
    expect((await timeEntryDelete(testRequest(`/api/time-entries/${dataA.timeEntryId}`, { method: 'DELETE', user }), P(dataA.timeEntryId))).status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot DELETE Firm-01\'s calendar event (query-param id, not a dynamic route)', async (label) => {
    const user = attacker(label)
    const res = await calendarDelete(testRequest(`/api/calendar-events?id=${dataA.calendarEventId}`, { method: 'DELETE', user }))
    expect(res.status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot DELETE/DOWNLOAD/OCR/SIGN Firm-01\'s document', async (label) => {
    const user = attacker(label)
    expect((await documentDownload(testRequest(`/api/documents/${dataA.documentId}/download`, { user }), P(dataA.documentId))).status).toBe(404)
    expect((await documentOcr(testRequest(`/api/documents/${dataA.documentId}/ocr`, { method: 'POST', user }), P(dataA.documentId))).status).toBe(404)
    expect((await signHistory(testRequest(`/api/documents/${dataA.documentId}/sign`, { user }), P(dataA.documentId))).status).toBe(404)
    expect((await signDoc(testRequest(`/api/documents/${dataA.documentId}/sign`, { method: 'POST', user }), P(dataA.documentId))).status).toBe(404)
    const del = await documentDelete(testRequest(`/api/documents/${dataA.documentId}`, { method: 'DELETE', user }), P(dataA.documentId))
    expect(del.status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s cannot make the AI "review" or "analyze" Firm-01\'s document by ID (blocked before any AI call, regardless of service config)', async (label) => {
    const user = attacker(label)
    const review = await contractReview(testRequest('/api/ai/contract-review', { method: 'POST', user, body: { documentId: dataA.documentId } }))
    expect(review.status).toBe(404)
    const analysis = await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user, body: { documentId: dataA.documentId } }))
    expect(analysis.status).toBe(404)
  })

  it.each(ATTACKER_LABELS)('%s\'s office-wide search never surfaces Firm-01\'s client by exact name', async (label) => {
    const user = attacker(label)
    const client = await prisma.client.findUniqueOrThrow({ where: { id: dataA.clientId } })
    const res = await officeSearch(testRequest(`/api/search?q=${encodeURIComponent(client.name)}`, { user }))
    expect(res.status).toBe(200)
    const body = await readJson(res)
    // The response echoes the submitted query string back in `query` — check
    // the actual RESULT arrays are empty, not the whole payload (which
    // trivially "contains" whatever was searched for).
    const results = JSON.stringify({ clients: body.clients, cases: body.cases, invoices: body.invoices, documents: body.documents })
    expect(results).not.toContain(dataA.clientId)
    expect(results).not.toContain(client.name)
    expect(body.clients).toEqual([])
  })

  it('the document row still exists untouched after every attack above (no partial-write corruption)', async () => {
    const doc = await prisma.document.findUnique({ where: { id: dataA.documentId } })
    expect(doc).not.toBeNull()
    expect(doc!.officeId).toBe(firmA.officeId)
    const kase = await prisma.case.findUnique({ where: { id: dataA.caseId } })
    expect(kase!.title).toBe('Confidential case') // the PATCH attempts above never actually landed
  })

  it('non-existent, malformed, and SQL-injection-shaped IDs all 404 cleanly (no 500, no bypass) for a legitimate Firm-02 user', async () => {
    const payloads = ['does-not-exist', "' OR '1'='1", '../../etc/passwd', '<script>alert(1)</script>', '1; DROP TABLE "Case";--', '']
    for (const id of payloads) {
      const res = await caseGet(testRequest(`/api/cases/${encodeURIComponent(id || 'x')}`, { user: firmB }), P(id))
      expect([404, 400]).toContain(res.status)
    }
  })
})
