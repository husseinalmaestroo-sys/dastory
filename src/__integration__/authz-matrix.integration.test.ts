// The authorization grid: for every protected /api route, prove that the
// wrong caller is rejected BEFORE any handler logic runs. This is the
// single systematic check that a new route can't silently ship without a
// guard — the per-entity tests cover the happy path and tenant isolation,
// this covers "who is even allowed to knock".
//
// Deliberately NOT listed (public by design, verified elsewhere):
//   /api/health, /api/auth/logout                — no auth needed
//   /api/auth/{login,signup,forgot-password,reset-password,verify-email,2fa/verify}
//                                                 — these ARE the auth layer
//   /api/billing/webhook                          — Stripe signature is the auth
//   /api/trial-requests [POST]                    — public signup form (rate-limited)
//   /api/site-settings [GET]                      — public: only returns content
//                                                   already shown on the landing
//                                                   page; PATCH below is gated
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { cleanupOffice, createColleague, createTestOfficeUser, testParams, testRequest, type TestUser } from './helpers'
import { prisma } from '@/lib/prisma'

import { POST as aiAssistant } from '@/app/api/ai/assistant/route'
import { POST as aiCase } from '@/app/api/ai/case-analysis/route'
import { POST as aiDraft } from '@/app/api/ai/contract-draft/route'
import { POST as aiDraftExport } from '@/app/api/ai/contract-draft/export/route'
import { POST as aiReview } from '@/app/api/ai/contract-review/route'
import { GET as casesList, POST as casesCreate } from '@/app/api/cases/route'
import { GET as caseGet, PATCH as casePatch, DELETE as caseDelete } from '@/app/api/cases/[id]/route'
import { GET as clientsList, POST as clientsCreate } from '@/app/api/clients/route'
import { GET as clientGet, PATCH as clientPatch, DELETE as clientDelete } from '@/app/api/clients/[id]/route'
import { GET as invoicesList, POST as invoicesCreate } from '@/app/api/invoices/route'
import { PATCH as invoicePatch, DELETE as invoiceDelete } from '@/app/api/invoices/[id]/route'
import { GET as sessionsList, POST as sessionsCreate } from '@/app/api/sessions/route'
import { PATCH as sessionPatch, DELETE as sessionDelete } from '@/app/api/sessions/[id]/route'
import { GET as documentsList } from '@/app/api/documents/route'
import { POST as documentsUpload } from '@/app/api/documents/upload/route'
import { DELETE as documentDelete } from '@/app/api/documents/[id]/route'
import { GET as documentDownload } from '@/app/api/documents/[id]/download/route'
import { POST as documentOcr } from '@/app/api/documents/[id]/ocr/route'
import { GET as signHistory, POST as signDoc } from '@/app/api/documents/[id]/sign/route'
import { GET as timeEntriesList, POST as timeEntriesCreate } from '@/app/api/time-entries/route'
import { PATCH as timeEntryPatch, DELETE as timeEntryDelete } from '@/app/api/time-entries/[id]/route'
import { GET as calendarList, POST as calendarCreate, DELETE as calendarDelete } from '@/app/api/calendar-events/route'
import { GET as officeSearch } from '@/app/api/search/route'
import { POST as legalSearch } from '@/app/api/search/legal/route'
import { GET as dashboard } from '@/app/api/dashboard/route'
import { GET as billingStatus } from '@/app/api/billing/status/route'
import { POST as emailSend } from '@/app/api/email/send/route'
import { GET as auditLogs } from '@/app/api/audit-logs/route'
import { GET as reports } from '@/app/api/reports/route'
import { POST as teamCreate, PATCH as teamPatch } from '@/app/api/team/route'
import { POST as citizenCreateAccount } from '@/app/api/citizen/create-account/route'
import { GET as officeExport } from '@/app/api/office/export/route'
import { PATCH as siteSettingsPatch } from '@/app/api/site-settings/route'
import { GET as trialRequestsGet } from '@/app/api/trial-requests/route'
import { GET as adminOverview } from '@/app/api/admin/overview/route'
import { POST as adminActivate } from '@/app/api/admin/offices/[officeId]/activate/route'
import { POST as adminSuspend } from '@/app/api/admin/offices/[officeId]/suspend/route'
import { POST as adminExtendTrial } from '@/app/api/admin/offices/[officeId]/extend-trial/route'
import { GET as citizenCases } from '@/app/api/citizen/cases/route'
import { GET as citizenInvoices } from '@/app/api/citizen/invoices/route'
import { GET as citizenSessions } from '@/app/api/citizen/sessions/route'
import { GET as authMe } from '@/app/api/auth/me/route'
import { GET as twoFactor } from '@/app/api/auth/2fa/route'
import { GET as notifications } from '@/app/api/notifications/route'
import { POST as resendVerification } from '@/app/api/auth/verify-email/resend/route'


type Access = 'office' | 'manager' | 'platformAdmin' | 'citizen' | 'active'

interface Row {
  label: string
  access: Access
  run: (user: TestUser | null) => Promise<Response> | Response
}

const P = testParams({ id: 'does-not-exist' })
const OfficeP = testParams({ officeId: 'does-not-exist' })
const req = (path: string, method: string, user: TestUser | null, body?: unknown) =>
  testRequest(path, { method, user: user ?? undefined, body: body ?? (method === 'GET' ? undefined : {}) })

const ROWS: Row[] = [
  // ---- office staff only (MANAGER or LAWYER; never CITIZEN, never anon) ----
  { label: 'POST /ai/assistant', access: 'office', run: (u) => aiAssistant(req('/api/ai/assistant', 'POST', u, { message: 'x' })) },
  { label: 'POST /ai/case-analysis', access: 'office', run: (u) => aiCase(req('/api/ai/case-analysis', 'POST', u)) },
  { label: 'POST /ai/contract-draft', access: 'office', run: (u) => aiDraft(req('/api/ai/contract-draft', 'POST', u)) },
  { label: 'POST /ai/contract-draft/export', access: 'office', run: (u) => aiDraftExport(req('/api/ai/contract-draft/export', 'POST', u)) },
  { label: 'POST /ai/contract-review', access: 'office', run: (u) => aiReview(req('/api/ai/contract-review', 'POST', u)) },
  { label: 'GET /cases', access: 'office', run: (u) => casesList(req('/api/cases', 'GET', u)) },
  { label: 'POST /cases', access: 'office', run: (u) => casesCreate(req('/api/cases', 'POST', u)) },
  { label: 'GET /cases/[id]', access: 'office', run: (u) => caseGet(req('/api/cases/x', 'GET', u), P) },
  { label: 'PATCH /cases/[id]', access: 'office', run: (u) => casePatch(req('/api/cases/x', 'PATCH', u), P) },
  { label: 'DELETE /cases/[id]', access: 'office', run: (u) => caseDelete(req('/api/cases/x', 'DELETE', u), P) },
  { label: 'GET /clients', access: 'office', run: (u) => clientsList(req('/api/clients', 'GET', u)) },
  { label: 'POST /clients', access: 'office', run: (u) => clientsCreate(req('/api/clients', 'POST', u)) },
  { label: 'GET /clients/[id]', access: 'office', run: (u) => clientGet(req('/api/clients/x', 'GET', u), P) },
  { label: 'PATCH /clients/[id]', access: 'office', run: (u) => clientPatch(req('/api/clients/x', 'PATCH', u), P) },
  { label: 'DELETE /clients/[id]', access: 'office', run: (u) => clientDelete(req('/api/clients/x', 'DELETE', u), P) },
  { label: 'GET /invoices', access: 'office', run: (u) => invoicesList(req('/api/invoices', 'GET', u)) },
  { label: 'POST /invoices', access: 'office', run: (u) => invoicesCreate(req('/api/invoices', 'POST', u)) },
  { label: 'PATCH /invoices/[id]', access: 'office', run: (u) => invoicePatch(req('/api/invoices/x', 'PATCH', u), P) },
  { label: 'DELETE /invoices/[id]', access: 'office', run: (u) => invoiceDelete(req('/api/invoices/x', 'DELETE', u), P) },
  { label: 'GET /sessions', access: 'office', run: (u) => sessionsList(req('/api/sessions', 'GET', u)) },
  { label: 'POST /sessions', access: 'office', run: (u) => sessionsCreate(req('/api/sessions', 'POST', u)) },
  { label: 'PATCH /sessions/[id]', access: 'office', run: (u) => sessionPatch(req('/api/sessions/x', 'PATCH', u), P) },
  { label: 'DELETE /sessions/[id]', access: 'office', run: (u) => sessionDelete(req('/api/sessions/x', 'DELETE', u), P) },
  { label: 'GET /documents', access: 'office', run: (u) => documentsList(req('/api/documents', 'GET', u)) },
  { label: 'POST /documents/upload', access: 'office', run: (u) => documentsUpload(req('/api/documents/upload', 'POST', u)) },
  { label: 'DELETE /documents/[id]', access: 'office', run: (u) => documentDelete(req('/api/documents/x', 'DELETE', u), P) },
  { label: 'GET /documents/[id]/download', access: 'office', run: (u) => documentDownload(req('/api/documents/x/download', 'GET', u), P) },
  { label: 'POST /documents/[id]/ocr', access: 'office', run: (u) => documentOcr(req('/api/documents/x/ocr', 'POST', u), P) },
  { label: 'GET /documents/[id]/sign', access: 'office', run: (u) => signHistory(req('/api/documents/x/sign', 'GET', u), P) },
  { label: 'POST /documents/[id]/sign', access: 'office', run: (u) => signDoc(req('/api/documents/x/sign', 'POST', u), P) },
  { label: 'GET /time-entries', access: 'office', run: (u) => timeEntriesList(req('/api/time-entries', 'GET', u)) },
  { label: 'POST /time-entries', access: 'office', run: (u) => timeEntriesCreate(req('/api/time-entries', 'POST', u)) },
  { label: 'PATCH /time-entries/[id]', access: 'office', run: (u) => timeEntryPatch(req('/api/time-entries/x', 'PATCH', u), P) },
  { label: 'DELETE /time-entries/[id]', access: 'office', run: (u) => timeEntryDelete(req('/api/time-entries/x', 'DELETE', u), P) },
  { label: 'GET /calendar-events', access: 'office', run: (u) => calendarList(req('/api/calendar-events', 'GET', u)) },
  { label: 'POST /calendar-events', access: 'office', run: (u) => calendarCreate(req('/api/calendar-events', 'POST', u)) },
  { label: 'DELETE /calendar-events', access: 'office', run: (u) => calendarDelete(req('/api/calendar-events', 'DELETE', u)) },
  { label: 'GET /search', access: 'office', run: (u) => officeSearch(req('/api/search?q=x', 'GET', u)) },
  { label: 'POST /search/legal', access: 'office', run: (u) => legalSearch(req('/api/search/legal', 'POST', u, { query: 'x' })) },
  { label: 'GET /dashboard', access: 'office', run: (u) => dashboard(req('/api/dashboard', 'GET', u)) },
  { label: 'GET /billing/status', access: 'office', run: (u) => billingStatus(req('/api/billing/status', 'GET', u)) },
  { label: 'POST /email/send', access: 'office', run: (u) => emailSend(req('/api/email/send', 'POST', u)) },

  // ---- office MANAGER only ----
  { label: 'GET /audit-logs', access: 'manager', run: (u) => auditLogs(req('/api/audit-logs', 'GET', u)) },
  { label: 'GET /reports', access: 'manager', run: (u) => reports(req('/api/reports', 'GET', u)) },
  { label: 'POST /team', access: 'manager', run: (u) => teamCreate(req('/api/team', 'POST', u)) },
  { label: 'PATCH /team', access: 'manager', run: (u) => teamPatch(req('/api/team', 'PATCH', u)) },
  { label: 'POST /citizen/create-account', access: 'manager', run: (u) => citizenCreateAccount(req('/api/citizen/create-account', 'POST', u)) },
  { label: 'GET /office/export', access: 'manager', run: (u) => officeExport(req('/api/office/export', 'GET', u)) },

  // ---- platform admin only ----
  { label: 'PATCH /site-settings', access: 'platformAdmin', run: (u) => siteSettingsPatch(req('/api/site-settings', 'PATCH', u)) },
  { label: 'GET /trial-requests', access: 'platformAdmin', run: (u) => trialRequestsGet(req('/api/trial-requests', 'GET', u)) },
  { label: 'GET /admin/overview', access: 'platformAdmin', run: (u) => adminOverview(req('/api/admin/overview', 'GET', u)) },
  { label: 'POST /admin/offices/:id/activate', access: 'platformAdmin', run: (u) => adminActivate(req('/api/admin/offices/x/activate', 'POST', u), OfficeP) },
  { label: 'POST /admin/offices/:id/suspend', access: 'platformAdmin', run: (u) => adminSuspend(req('/api/admin/offices/x/suspend', 'POST', u), OfficeP) },
  { label: 'POST /admin/offices/:id/extend-trial', access: 'platformAdmin', run: (u) => adminExtendTrial(req('/api/admin/offices/x/extend-trial', 'POST', u), OfficeP) },

  // ---- CITIZEN only (office staff must NOT reach these) ----
  { label: 'GET /citizen/cases', access: 'citizen', run: (u) => citizenCases(req('/api/citizen/cases', 'GET', u)) },
  { label: 'GET /citizen/invoices', access: 'citizen', run: (u) => citizenInvoices(req('/api/citizen/invoices', 'GET', u)) },
  { label: 'GET /citizen/sessions', access: 'citizen', run: (u) => citizenSessions(req('/api/citizen/sessions', 'GET', u)) },

  // ---- any authenticated (incl. CITIZEN) — only anon is rejected ----
  { label: 'GET /auth/me', access: 'active', run: (u) => authMe(req('/api/auth/me', 'GET', u)) },
  { label: 'GET /auth/2fa', access: 'active', run: (u) => twoFactor(req('/api/auth/2fa', 'GET', u)) },
  { label: 'GET /notifications', access: 'active', run: (u) => notifications(req('/api/notifications', 'GET', u)) },
  { label: 'POST /auth/verify-email/resend', access: 'active', run: (u) => resendVerification(req('/api/auth/verify-email/resend', 'POST', u)) },
]

// One office + one user per role, created once and reused by every row.
let manager: TestUser
let lawyer: TestUser
let citizen: TestUser
let officeId: string

beforeAll(async () => {
  manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  officeId = manager.officeId
  lawyer = await createColleague(officeId, { role: Role.LAWYER })
  const client = await prisma.client.create({ data: { name: 'Matrix Client', officeId, ownerId: manager.id } })
  citizen = await createColleague(officeId, { role: Role.CITIZEN, clientId: client.id })
})
afterAll(async () => {
  await cleanupOffice(officeId)
})

describe('authorization matrix — every protected route rejects the wrong caller', () => {
  it.each(ROWS)('$label — anonymous is rejected (401)', async ({ run }) => {
    expect((await run(null)).status).toBe(401)
  })

  it.each(ROWS.filter((r) => r.access === 'office'))('$label — a CITIZEN is rejected (403)', async ({ run }) => {
    expect((await run(citizen)).status).toBe(403)
  })

  it.each(ROWS.filter((r) => r.access === 'manager' || r.access === 'platformAdmin'))(
    '$label — a LAWYER is rejected (403)',
    async ({ run }) => {
      expect((await run(lawyer)).status).toBe(403)
    },
  )

  it.each(ROWS.filter((r) => r.access === 'manager' || r.access === 'platformAdmin'))(
    '$label — a CITIZEN is rejected (403)',
    async ({ run }) => {
      expect((await run(citizen)).status).toBe(403)
    },
  )

  it.each(ROWS.filter((r) => r.access === 'platformAdmin'))(
    '$label — a non-platform-admin office manager is rejected (403)',
    async ({ run }) => {
      expect((await run(manager)).status).toBe(403)
    },
  )

  it.each(ROWS.filter((r) => r.access === 'citizen'))('$label — an office user is rejected (403)', async ({ run }) => {
    expect((await run(manager)).status).toBe(403)
  })
})
