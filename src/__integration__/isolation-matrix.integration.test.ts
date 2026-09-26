// Isolation matrix for Phase 1:
//  (1) Tenant A vs Tenant B on every endpoint added or changed in this phase
//      (GET-by-id, summaries, filters, date ranges, sort order).
//  (2) Lawyer A vs Lawyer B in the SAME office across every resource type —
//      the audit had these partly code-traced only.
// Cross-office GET/PATCH/DELETE on the original [id] routes is covered by
// pilot-audit-idor.integration.test.ts and tenant-isolation.integration.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeDocumentFile } from '@/lib/document-storage'
import { GET as casesList } from '@/app/api/cases/route'
import { GET as caseGet, PATCH as casePatch, DELETE as caseDelete } from '@/app/api/cases/[id]/route'
import { GET as clientsList } from '@/app/api/clients/route'
import { GET as clientGet, PATCH as clientPatch, DELETE as clientDelete } from '@/app/api/clients/[id]/route'
import { GET as sessionsList } from '@/app/api/sessions/route'
import { GET as sessionGet, PATCH as sessionPatch, DELETE as sessionDelete } from '@/app/api/sessions/[id]/route'
import { GET as invoicesList } from '@/app/api/invoices/route'
import { GET as invoiceGet, PATCH as invoicePatch, DELETE as invoiceDelete } from '@/app/api/invoices/[id]/route'
import { GET as invoiceSummary } from '@/app/api/invoices/summary/route'
import { GET as timeList } from '@/app/api/time-entries/route'
import { PATCH as timePatch, DELETE as timeDelete } from '@/app/api/time-entries/[id]/route'
import { GET as timeSummary } from '@/app/api/time-entries/summary/route'
import { GET as documentsList } from '@/app/api/documents/route'
import { DELETE as documentDelete } from '@/app/api/documents/[id]/route'
import { GET as documentDownload } from '@/app/api/documents/[id]/download/route'
import { POST as documentOcr } from '@/app/api/documents/[id]/ocr/route'
import { GET as signHistory, POST as signDoc } from '@/app/api/documents/[id]/sign/route'
import { GET as calendarList } from '@/app/api/calendar-events/route'
import { GET as notificationsList } from '@/app/api/notifications/route'
import { GET as searchGet } from '@/app/api/search/route'
import { GET as teamList, PATCH as teamPatch, POST as teamCreate } from '@/app/api/team/route'
import { GET as reportsGet } from '@/app/api/reports/route'
import { GET as auditLogsGet } from '@/app/api/audit-logs/route'
import { GET as officeExport } from '@/app/api/office/export/route'
import { GET as dashboardGet } from '@/app/api/dashboard/route'
import { POST as contractReview } from '@/app/api/ai/contract-review/route'
import { POST as caseAnalysis } from '@/app/api/ai/case-analysis/route'
import { cleanupOffice, createColleague, createTestOfficeUser, readJson, testFormRequest, testParams, testRequest, type TestUser } from './helpers'

type Fixture = {
  officeId: string
  manager: TestUser
  lawyer: TestUser
  clientId: string
  caseId: string
  sessionId: string
  invoiceId: string
  timeId: string
  documentId: string
  eventId: string
  marker: string
}

const offices: string[] = []
let A: Fixture // tenant A, owned by lawyer A1
let lawyerA2: TestUser // same office as A, different lawyer
let B: Fixture // tenant B

async function seed(label: string): Promise<Fixture> {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  offices.push(manager.officeId)
  const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
  const officeId = manager.officeId
  const marker = `${label}-${Date.now()}`
  const client = await prisma.client.create({ data: { name: `${marker} client`, officeId, ownerId: lawyer.id } })
  const kase = await prisma.case.create({ data: { number: `${marker}-C`, title: `${marker} case`, type: 'مدني', clientId: client.id, ownerId: lawyer.id, lawyerId: lawyer.id, officeId } })
  const session = await prisma.session.create({ data: { caseId: kase.id, officeId, date: new Date(Date.now() + 5 * 864e5), time: '09:00', court: `${marker} court` } })
  const invoice = await prisma.invoice.create({ data: { number: `${marker}-I`, amount: '777.777', clientId: client.id, caseId: kase.id, officeId } })
  const time = await prisma.timeEntry.create({ data: { officeId, userId: lawyer.id, caseId: kase.id, task: `${marker} task`, minutes: 4242 } })
  const url = await writeDocumentFile(officeId, lawyer.id, `${marker}.txt`, 'TXT', Buffer.from(`${marker} confidential contract text long enough to read`))
  const doc = await prisma.document.create({ data: { name: `${marker}.txt`, type: 'TXT', officeId, ownerId: lawyer.id, caseId: kase.id, url } })
  const event = await prisma.calendarEvent.create({ data: { title: `${marker} event`, date: new Date(Date.now() + 3 * 864e5), officeId, createdById: lawyer.id } })
  await prisma.notification.create({ data: { userId: lawyer.id, officeId, title: `${marker} notif`, body: `${marker} body` } })
  return { officeId, manager, lawyer, clientId: client.id, caseId: kase.id, sessionId: session.id, invoiceId: invoice.id, timeId: time.id, documentId: doc.id, eventId: event.id, marker }
}

beforeAll(async () => {
  A = await seed('TENANT-A')
  B = await seed('TENANT-B')
  lawyerA2 = await createColleague(A.officeId, { role: Role.LAWYER })
})
afterAll(async () => {
  await Promise.all(offices.map(cleanupOffice))
})

const get = (h: (r: NextRequest) => Promise<Response>, path: string, user: TestUser) => h(testRequest(path, { user }))
const byId = (h: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>, path: string, id: string, user: TestUser, method = 'GET', body?: unknown) =>
  h(testRequest(path, { method, user, body }), testParams({ id }))

/** Every per-object operation on the target fixture, as `user`. Returns status codes. */
async function objectMatrix(target: Fixture, user: TestUser) {
  const pngForm = () => {
    const fd = new FormData()
    fd.append('signatureImage', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 's.png', { type: 'image/png' }))
    return fd
  }
  return {
    'case GET': (await byId(caseGet, `/api/cases/${target.caseId}`, target.caseId, user)).status,
    'case PATCH': (await byId(casePatch, `/api/cases/${target.caseId}`, target.caseId, user, 'PATCH', { title: 'pwned' })).status,
    'client GET': (await byId(clientGet, `/api/clients/${target.clientId}`, target.clientId, user)).status,
    'client PATCH': (await byId(clientPatch, `/api/clients/${target.clientId}`, target.clientId, user, 'PATCH', { name: 'pwned' })).status,
    'session GET': (await byId(sessionGet, `/api/sessions/${target.sessionId}`, target.sessionId, user)).status,
    'session PATCH': (await byId(sessionPatch, `/api/sessions/${target.sessionId}`, target.sessionId, user, 'PATCH', { court: 'pwned' })).status,
    'invoice GET': (await byId(invoiceGet, `/api/invoices/${target.invoiceId}`, target.invoiceId, user)).status,
    'invoice PATCH': (await byId(invoicePatch, `/api/invoices/${target.invoiceId}`, target.invoiceId, user, 'PATCH', { notes: 'pwned' })).status,
    'time PATCH': (await byId(timePatch, `/api/time-entries/${target.timeId}`, target.timeId, user, 'PATCH', { task: 'pwned' })).status,
    'document download': (await byId(documentDownload, `/api/documents/${target.documentId}/download`, target.documentId, user)).status,
    'document OCR': (await byId(documentOcr, `/api/documents/${target.documentId}/ocr`, target.documentId, user, 'POST')).status,
    'document sign history': (await byId(signHistory, `/api/documents/${target.documentId}/sign`, target.documentId, user)).status,
    'document sign': (await signDoc(testFormRequest(`/api/documents/${target.documentId}/sign`, { user, formData: pngForm() }), testParams({ id: target.documentId }))).status,
    'AI contract review (doc)': (await contractReview(testRequest('/api/ai/contract-review', { method: 'POST', user, body: { documentId: target.documentId } }))).status,
    'AI case analysis (doc)': (await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user, body: { documentId: target.documentId } }))).status,
    // Destructive checks last.
    'time DELETE': (await byId(timeDelete, `/api/time-entries/${target.timeId}`, target.timeId, user, 'DELETE')).status,
    'session DELETE': (await byId(sessionDelete, `/api/sessions/${target.sessionId}`, target.sessionId, user, 'DELETE')).status,
    'invoice DELETE': (await byId(invoiceDelete, `/api/invoices/${target.invoiceId}`, target.invoiceId, user, 'DELETE')).status,
    'document DELETE': (await byId(documentDelete, `/api/documents/${target.documentId}`, target.documentId, user, 'DELETE')).status,
    'client DELETE': (await byId(clientDelete, `/api/clients/${target.clientId}`, target.clientId, user, 'DELETE')).status,
    'case DELETE': (await byId(caseDelete, `/api/cases/${target.caseId}`, target.caseId, user, 'DELETE')).status,
  }
}

/**
 * Every list/search/aggregate endpoint as `user`; returns the concatenated
 * response text. `includeCalendar: false` for same-office checks — the office
 * calendar is intentionally shared office-wide (see the dedicated test).
 */
async function everyListAsText(user: TestUser, { includeCalendar = true } = {}) {
  const now = new Date()
  const range = `from=${new Date(now.getTime() - 864e5).toISOString()}&to=${new Date(now.getTime() + 30 * 864e5).toISOString()}`
  const responses = await Promise.all([
    get(casesList, '/api/cases', user),
    get(casesList, '/api/cases?status=ACTIVE', user),
    get(clientsList, '/api/clients', user),
    get(sessionsList, '/api/sessions', user),
    get(sessionsList, `/api/sessions?${range}&order=desc`, user),
    get(invoicesList, '/api/invoices', user),
    get(timeList, '/api/time-entries', user),
    get(documentsList, '/api/documents', user),
    get(documentsList, '/api/documents?q=TENANT&types=TXT', user),
    ...(includeCalendar ? [get(calendarList, `/api/calendar-events?${range}`, user)] : []),
    get(notificationsList, '/api/notifications', user),
    get(searchGet, '/api/search?q=TENANT', user),
    get(dashboardGet, '/api/dashboard', user),
  ])
  for (const r of responses) expect(r.status).toBe(200)
  return (await Promise.all(responses.map((r) => r.text()))).join('\n')
}

describe('(1) tenant A vs tenant B — every per-object operation is a safe 404', () => {
  it('tenant B\'s manager gets 404 on all of tenant A\'s objects, and nothing changed', async () => {
    const statuses = await objectMatrix(A, B.manager)
    for (const [op, status] of Object.entries(statuses)) expect([op, status]).toEqual([op, 404])
    const untouched = await prisma.case.findUniqueOrThrow({ where: { id: A.caseId } })
    expect(untouched.title).not.toBe('pwned')
    expect(await prisma.invoice.count({ where: { id: A.invoiceId } })).toBe(1)
    expect(await prisma.document.count({ where: { id: A.documentId } })).toBe(1)
  })

  it('no list, search, filter, range or dashboard response for tenant B contains tenant A data', async () => {
    for (const user of [B.manager, B.lawyer]) {
      const text = await everyListAsText(user)
      expect(text).not.toContain(A.marker)
      expect(text).toContain(B.marker) // positive control — the lists aren't just empty
    }
  })

  it('aggregates are tenant-scoped: B\'s totals don\'t include A\'s money or minutes', async () => {
    const inv = await readJson(await get(invoiceSummary, '/api/invoices/summary', B.manager))
    expect(inv.totalAmount).toBe(777.777) // B's own single invoice, not 2 × 777.777
    const time = await readJson(await get(timeSummary, '/api/time-entries/summary', B.manager))
    expect(time.totalMinutes).toBe(4242)
  })

  it('the office export for B contains nothing from A', async () => {
    const res = await get(officeExport, '/api/office/export', B.manager)
    expect(res.status).toBe(200)
    const zip = Buffer.from(await res.arrayBuffer()).toString('latin1')
    expect(zip).not.toContain(A.marker)
  })
})

describe('(2) lawyer A1 vs lawyer A2 in the same office', () => {
  it('A2 gets 404 on every object owned by A1 (cases, clients, sessions, invoices, time, documents, AI)', async () => {
    // Fresh A1-owned objects inside office A (the shared fixture A is used by
    // other tests; this one runs destructive operations).
    const officeId = A.officeId
    const owner = A.lawyer.id
    const client = await prisma.client.create({ data: { name: 'A1-only client', officeId, ownerId: owner } })
    const kase = await prisma.case.create({ data: { number: `A1-${Date.now()}`, title: 'A1-only case', type: 'مدني', clientId: client.id, ownerId: owner, lawyerId: owner, officeId } })
    const session = await prisma.session.create({ data: { caseId: kase.id, officeId, date: new Date(Date.now() + 864e5), time: '11:00', court: 'A1 court' } })
    const invoice = await prisma.invoice.create({ data: { number: `A1-I-${Date.now()}`, amount: '10', clientId: client.id, caseId: kase.id, officeId } })
    const time = await prisma.timeEntry.create({ data: { officeId, userId: owner, caseId: kase.id, task: 'A1 task', minutes: 5 } })
    const url = await writeDocumentFile(officeId, owner, 'a1.txt', 'TXT', Buffer.from('A1 private text that is long enough'))
    const doc = await prisma.document.create({ data: { name: 'a1.txt', type: 'TXT', officeId, ownerId: owner, caseId: kase.id, url } })
    const target = { ...A, clientId: client.id, caseId: kase.id, sessionId: session.id, invoiceId: invoice.id, timeId: time.id, documentId: doc.id }

    const statuses = await objectMatrix(target, lawyerA2)
    for (const [op, status] of Object.entries(statuses)) expect([op, status]).toEqual([op, 404])
  })

  it('A2\'s lists, search and summaries never include A1\'s work', async () => {
    const text = await everyListAsText(lawyerA2, { includeCalendar: false })
    expect(text).not.toContain(A.marker)
    const inv = await readJson(await get(invoiceSummary, '/api/invoices/summary', lawyerA2))
    expect(inv.count).toBe(0)
    const time = await readJson(await get(timeSummary, '/api/time-entries/summary', lawyerA2))
    expect(time.totalMinutes).toBe(0)
  })

  it('the office calendar is intentionally shared office-wide — but only its creator (or the manager) can delete an event', async () => {
    const events = await readJson(await get(calendarList, '/api/calendar-events', lawyerA2))
    expect(events.map((e: { id: string }) => e.id)).toContain(A.eventId)
    const { DELETE: calendarDelete } = await import('@/app/api/calendar-events/route')
    const res = await calendarDelete(testRequest(`/api/calendar-events?id=${A.eventId}`, { method: 'DELETE', user: lawyerA2 }))
    expect(res.status).toBe(403)
    expect(await prisma.calendarEvent.count({ where: { id: A.eventId } })).toBe(1)
  })

  it('a lawyer sees only themself in the team list and cannot manage staff', async () => {
    const team = await readJson(await get(teamList, '/api/team', lawyerA2))
    expect(team.map((m: { id: string }) => m.id)).toEqual([lawyerA2.id])
    expect((await teamPatch(testRequest('/api/team', { method: 'PATCH', user: lawyerA2, body: { id: A.lawyer.id, active: false } }))).status).toBe(403)
    expect((await teamCreate(testRequest('/api/team', { method: 'POST', user: lawyerA2, body: { name: 'x', email: `x-${Date.now()}@e.jo`, password: 'Passw0rd!Passw0rd' } }))).status).toBe(403)
  })

  it('office-wide data (reports, audit logs, export) is manager-only', async () => {
    for (const [handler, path] of [[reportsGet, '/api/reports'], [auditLogsGet, '/api/audit-logs'], [officeExport, '/api/office/export']] as const) {
      expect((await get(handler, path, lawyerA2)).status).toBe(403)
    }
  })

  it('positive control: the office manager intentionally sees every lawyer\'s work', async () => {
    const text = await everyListAsText(A.manager)
    expect(text).toContain(A.marker)
    expect((await byId(caseGet, `/api/cases/${A.caseId}`, A.caseId, A.manager)).status).toBe(200)
    expect((await get(reportsGet, '/api/reports', A.manager)).status).toBe(200)
  })
})
