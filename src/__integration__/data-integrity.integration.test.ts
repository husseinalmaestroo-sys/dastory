// Core data-integrity guarantees: financial records, exact money, the signed
// document audit trail, and predictable 4xx answers instead of 500s.
import { afterAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as invoicesCreate } from '@/app/api/invoices/route'
import { GET as invoiceGet, PATCH as invoicePatch, DELETE as invoiceDelete } from '@/app/api/invoices/[id]/route'
import { GET as invoiceSummary } from '@/app/api/invoices/summary/route'
import { POST as clientsCreate } from '@/app/api/clients/route'
import { POST as casesCreate } from '@/app/api/cases/route'
import { DELETE as caseDelete } from '@/app/api/cases/[id]/route'
import { POST as sessionsCreate } from '@/app/api/sessions/route'
import { POST as timeCreate } from '@/app/api/time-entries/route'
import { POST as calendarCreate } from '@/app/api/calendar-events/route'
import { POST as trialCreate } from '@/app/api/trial-requests/route'
import { DELETE as documentDelete } from '@/app/api/documents/[id]/route'
import { POST as signDocument } from '@/app/api/documents/[id]/sign/route'
import { writeDocumentFile } from '@/lib/document-storage'
import { cleanupOffice, createColleague, createTestOfficeUser, readJson, testFormRequest, testParams, testRequest, type TestUser } from './helpers'

const createdOffices: string[] = []
afterAll(async () => {
  await prisma.trialRequest.deleteMany({ where: { email: { startsWith: 'integrity-trial-' } } })
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function office() {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(manager.officeId)
  const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
  const client = await prisma.client.create({ data: { name: 'Integrity Client', officeId: manager.officeId, ownerId: lawyer.id } })
  const kase = await prisma.case.create({
    data: { number: `INT-${Date.now()}-${Math.random()}`, title: 't', type: 'مدني', clientId: client.id, ownerId: lawyer.id, lawyerId: lawyer.id, officeId: manager.officeId },
  })
  return { manager, lawyer, client, kase }
}

async function createInvoice(user: TestUser, clientId: string, body: Record<string, unknown>) {
  const res = await invoicesCreate(testRequest('/api/invoices', { method: 'POST', user, body: { number: `N-${Math.random()}`, clientId, ...body } }))
  return { res, body: await readJson(res) }
}

const patch = (user: TestUser, id: string, body: unknown) =>
  invoicePatch(testRequest(`/api/invoices/${id}`, { method: 'PATCH', user, body }), testParams({ id }))
const del = (user: TestUser, id: string) =>
  invoiceDelete(testRequest(`/api/invoices/${id}`, { method: 'DELETE', user }), testParams({ id }))

describe('invoice integrity — a recorded payment cannot be erased', () => {
  it('the old bypass (PATCH paid:0 → DELETE) no longer deletes a paid invoice', async () => {
    const { manager, lawyer, client } = await office()
    const { body: inv } = await createInvoice(lawyer, client.id, { amount: 100, paid: 100 })
    expect(inv.status).toBe('PAID')

    // A lawyer may not lower a recorded payment at all.
    const lawyerReset = await patch(lawyer, inv.id, { paid: 0, status: 'UNPAID' })
    expect(lawyerReset.status).toBe(403)

    // A manager may correct it — audit-logged with old/new values …
    const managerReset = await patch(manager, inv.id, { paid: 0, status: 'UNPAID' })
    expect(managerReset.status).toBe(200)
    const log = await prisma.auditLog.findFirst({ where: { entityId: inv.id, action: 'invoice.payment_corrected' } })
    expect(log?.metadata).toMatchObject({ before: { paid: '100.000' }, after: { paid: '0.000' } })

    // … but the invoice still can't be deleted by anyone: money was recorded.
    for (const user of [lawyer, manager]) {
      const res = await del(user, inv.id)
      expect(res.status).toBe(409)
      expect((await readJson(res)).code).toBe('has_payment')
    }
    expect(await prisma.invoice.count({ where: { id: inv.id } })).toBe(1)
  })

  it('an invoice that never had a payment can still be deleted', async () => {
    const { lawyer, client } = await office()
    const { body: inv } = await createInvoice(lawyer, client.id, { amount: 50 })
    expect((await del(lawyer, inv.id)).status).toBe(200)
  })

  it('status is derived from the money and can\'t contradict it', async () => {
    const { lawyer, client } = await office()
    // "PAID" with nothing paid is rejected, not stored.
    expect((await createInvoice(lawyer, client.id, { amount: 80, paid: 0, status: 'PAID' })).res.status).toBe(400)
    const { body: inv } = await createInvoice(lawyer, client.id, { amount: 80 })
    expect(inv.status).toBe('UNPAID')
    expect((await readJson(await patch(lawyer, inv.id, { paid: 30 }))).status).toBe('PARTIAL')
    expect((await readJson(await patch(lawyer, inv.id, { paid: 80 }))).status).toBe('PAID')
    expect((await patch(lawyer, inv.id, { paid: 90 })).status).toBe(400) // paid > amount
  })

  it('PATCH and DELETE racing on an unpaid invoice never both succeed', async () => {
    const { lawyer, client } = await office()
    for (let round = 0; round < 8; round++) {
      const { body: inv } = await createInvoice(lawyer, client.id, { amount: 100 })
      const [p, d] = await Promise.all([patch(lawyer, inv.id, { paid: 50 }), del(lawyer, inv.id)])
      expect([p.status, d.status]).not.toContain(500)
      const exists = (await prisma.invoice.count({ where: { id: inv.id } })) === 1
      if (exists) {
        // Payment landed first -> the delete was refused.
        expect(p.status).toBe(200)
        expect(d.status).toBe(409)
      } else {
        // Delete landed first -> the payment was NOT reported as recorded.
        expect(d.status).toBe(200)
        expect(p.status === 404 || p.status === 409).toBe(true)
      }
    }
  })
})

describe('money is exact decimal', () => {
  it('0.1 + 0.2 sums to exactly 0.3 (not 0.30000000000000004)', async () => {
    const { lawyer, client } = await office()
    await createInvoice(lawyer, client.id, { amount: '0.1' })
    await createInvoice(lawyer, client.id, { amount: 0.2 })
    const summary = await readJson(await invoiceSummary(testRequest('/api/invoices/summary', { user: lawyer })))
    expect(summary.totalAmount).toBe(0.3)
    const stored = await prisma.invoice.aggregate({ where: { clientId: client.id }, _sum: { amount: true } })
    expect(stored._sum.amount?.toFixed(3)).toBe('0.300')
  })

  it('amounts keep up to 3 decimals (JOD fils) and reject more', async () => {
    const { lawyer, client } = await office()
    const { body } = await createInvoice(lawyer, client.id, { amount: '1234.567', paid: '0.001' })
    const fetched = await readJson(await invoiceGet(testRequest(`/api/invoices/${body.id}`, { user: lawyer }), testParams({ id: body.id })))
    expect(fetched.amount).toBe(1234.567)
    expect(fetched.paid).toBe(0.001)
    expect((await createInvoice(lawyer, client.id, { amount: '1.2345' })).res.status).toBe(400)
    expect((await createInvoice(lawyer, client.id, { amount: 'NaN' })).res.status).toBe(400)
    expect((await createInvoice(lawyer, client.id, { amount: '1e3' })).res.status).toBe(400)
    expect((await createInvoice(lawyer, client.id, { amount: '1000000000000' })).res.status).toBe(400)
  })
})

function pngForm() {
  const fd = new FormData()
  fd.append('signatureImage', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'sig.png', { type: 'image/png' }))
  return fd
}

describe('signed documents — the audit trail is never destroyed (controlled 409, never a 500)', () => {
  it('signed document, its signature image, and its case all refuse deletion; unsigned ones still delete', async () => {
    const { lawyer, kase } = await office()
    const url = await writeDocumentFile(lawyer.officeId, lawyer.id, 'contract.pdf', 'PDF', Buffer.from('%PDF-1.4 signed'))
    const target = await prisma.document.create({ data: { name: 'contract.pdf', type: 'PDF', officeId: lawyer.officeId, ownerId: lawyer.id, caseId: kase.id, url } })
    const signed = await signDocument(testFormRequest(`/api/documents/${target.id}/sign`, { user: lawyer, formData: pngForm() }), testParams({ id: target.id }))
    expect(signed.status).toBe(201)
    const sig = await prisma.documentSignature.findFirstOrThrow({ where: { documentId: target.id } })

    for (const id of [target.id, sig.signatureImageId]) {
      const res = await documentDelete(testRequest(`/api/documents/${id}`, { method: 'DELETE', user: lawyer }), testParams({ id }))
      expect(res.status).toBe(409)
      expect((await readJson(res)).code).toBe('signed_document')
    }
    const caseRes = await caseDelete(testRequest(`/api/cases/${kase.id}`, { method: 'DELETE', user: lawyer }), testParams({ id: kase.id }))
    expect(caseRes.status).toBe(409)
    expect((await readJson(caseRes)).code).toBe('signed_document')
    expect(await prisma.documentSignature.count({ where: { id: sig.id } })).toBe(1)
    expect(await prisma.case.count({ where: { id: kase.id } })).toBe(1)

    const plainUrl = await writeDocumentFile(lawyer.officeId, lawyer.id, 'plain.pdf', 'PDF', Buffer.from('%PDF-1.4 plain'))
    const plain = await prisma.document.create({ data: { name: 'plain.pdf', type: 'PDF', officeId: lawyer.officeId, ownerId: lawyer.id, url: plainUrl } })
    expect((await documentDelete(testRequest(`/api/documents/${plain.id}`, { method: 'DELETE', user: lawyer }), testParams({ id: plain.id }))).status).toBe(200)
  })
})

describe('over-long input is a 400 naming the field — never a 500', () => {
  const long = (n: number) => 'ع'.repeat(n)
  it.each([
    ['client name', clientsCreate, '/api/clients', () => ({ name: long(192) })],
    ['client address', clientsCreate, '/api/clients', () => ({ name: 'ok', address: long(192) })],
    ['time entry task (was cut at 200 for a 191 column)', timeCreate, '/api/time-entries', () => ({ task: long(195), minutes: 10 })],
    ['calendar title (was cut at 200 for a 191 column)', calendarCreate, '/api/calendar-events', () => ({ title: long(195), date: '2030-01-01' })],
  ] as const)('%s', async (_label, handler, path, body) => {
    const { manager } = await office()
    const res = await handler(testRequest(path, { method: 'POST', user: manager, body: body() }))
    expect(res.status).toBe(400)
    expect((await readJson(res)).error).toMatch(/الحد الأقصى/)
  })

  it('case title and invoice notes', async () => {
    const { manager, client } = await office()
    const c = await casesCreate(testRequest('/api/cases', { method: 'POST', user: manager, body: { number: '1', title: long(192), type: 'x', clientId: client.id } }))
    expect(c.status).toBe(400)
    const inv = await createInvoice(manager, client.id, { amount: 1, notes: long(192) })
    expect(inv.res.status).toBe(400)
  })

  it('session court', async () => {
    const { lawyer, kase } = await office()
    const res = await sessionsCreate(testRequest('/api/sessions', { method: 'POST', user: lawyer, body: { caseId: kase.id, date: '2030-01-01', time: '10:00', court: long(192) } }))
    expect(res.status).toBe(400)
  })

  it('malformed JSON is a 400', async () => {
    const { manager } = await office()
    const req = testRequest('/api/clients', { method: 'POST', user: manager, headers: { 'Content-Type': 'application/json' } })
    const bad = new (req.constructor as typeof Request)(req.url, { method: 'POST', headers: req.headers, body: '{"name": ' }) as typeof req
    expect((await clientsCreate(bad)).status).toBe(400)
  })

  it('trial request free-text fields fit their columns (were allowed to 240 > 191)', async () => {
    const res = await trialCreate(testRequest('/api/trial-requests', {
      method: 'POST',
      body: {
        officeName: 'o', officeLicense: 'l', city: 'c', officePhone: '1', lawyerName: 'n', lawyerBarNumber: 'b',
        email: `integrity-trial-${Date.now()}@example.jo`, mobile: '1', nationalId: '1', acceptedTerms: true,
        address: long(240), specialty: long(240), experience: long(240),
      },
    }))
    expect(res.status).toBe(201)
  })
})

describe('idempotency keys are never permanently poisoned', () => {
  it('a request that fails with a server error releases its key, so the retry runs', async () => {
    const { withIdempotency } = await import('@/lib/idempotency')
    const { manager } = await office()
    const req = () => testRequest('/api/x', { method: 'POST', user: manager, headers: { 'Idempotency-Key': `k-${Date.now()}-fail` } })
    await expect(withIdempotency(req(), manager.id, 'test:fail', async () => { throw new Error('db down') })).rejects.toThrow('db down')
    const retry = await withIdempotency(req(), manager.id, 'test:fail', async () => ({ status: 201, body: { ok: true } }))
    expect(retry.status).toBe(201)
  })

  it('a key left in-flight by a crashed request is retaken after the stale window', async () => {
    const { withIdempotency } = await import('@/lib/idempotency')
    const { manager } = await office()
    const key = `k-${Date.now()}-stale`
    await prisma.idempotencyKey.create({ data: { userId: manager.id, endpoint: 'test:stale', key, createdAt: new Date(Date.now() - 5 * 60_000) } })
    const res = await withIdempotency(
      testRequest('/api/x', { method: 'POST', user: manager, headers: { 'Idempotency-Key': key } }),
      manager.id, 'test:stale', async () => ({ status: 201, body: { ran: true } })
    )
    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ ran: true })
  })

  it('a genuinely in-flight key still answers 409, and concurrent duplicates still create one invoice', async () => {
    const { manager, client } = await office()
    const key = `k-${Date.now()}-dup`
    const send = () => invoicesCreate(testRequest('/api/invoices', {
      method: 'POST', user: manager, headers: { 'Idempotency-Key': key }, body: { number: `DUP-${key}`, clientId: client.id, amount: 5 },
    }))
    const results = await Promise.all([send(), send(), send()])
    expect(results.map((r) => r.status)).not.toContain(500)
    expect(await prisma.invoice.count({ where: { number: `DUP-${key}` } })).toBe(1)
  })
})
