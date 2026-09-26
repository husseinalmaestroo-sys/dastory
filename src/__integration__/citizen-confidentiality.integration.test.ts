// The client (CITIZEN) portal returns only the allow-listed fields in
// src/lib/citizen-fields.ts. Internal staff data — lawyers' case notes,
// session notes, invoice notes, ownership ids — must never appear, even
// though the underlying rows carry it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GET as citizenCases } from '@/app/api/citizen/cases/route'
import { GET as citizenSessions } from '@/app/api/citizen/sessions/route'
import { GET as citizenInvoices } from '@/app/api/citizen/invoices/route'
import { GET as staffCases } from '@/app/api/cases/route'
import { CITIZEN_ALLOWED_KEYS } from '@/lib/citizen-fields'
import { cleanupOffice, createColleague, createTestOfficeUser, readJson, testRequest, type TestUser } from './helpers'

const SECRET = {
  caseNote: 'INTERNAL-CASE-NOTE-7f3e: client may be lying about the date',
  sessionNote: 'INTERNAL-SESSION-NOTE-19c2: judge seemed hostile',
  judge: 'JUDGE-NAME-5b1a',
  invoiceNote: 'INTERNAL-INVOICE-NOTE-a8d4: discount if they complain',
  otherClientCase: 'OTHER-CLIENT-CASE-TITLE-44e0',
}

let officeId: string
let lawyer: TestUser
let citizen: TestUser
let clientId: string

beforeAll(async () => {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  officeId = manager.officeId
  lawyer = await createColleague(officeId, { role: Role.LAWYER })

  const client = await prisma.client.create({ data: { name: 'Portal Client', officeId, ownerId: lawyer.id } })
  const other = await prisma.client.create({ data: { name: 'Other Client', officeId, ownerId: lawyer.id } })
  clientId = client.id

  const kase = await prisma.case.create({
    data: { number: 'CIT-1', title: 'Visible matter', type: 'مدني', clientId: client.id, ownerId: lawyer.id, lawyerId: lawyer.id, officeId, notes: SECRET.caseNote },
  })
  await prisma.case.create({
    data: { number: 'CIT-2', title: SECRET.otherClientCase, type: 'مدني', clientId: other.id, ownerId: lawyer.id, officeId, notes: 'x' },
  })
  await prisma.session.create({
    data: { caseId: kase.id, officeId, date: new Date(Date.now() + 864e5), time: '10:00', court: 'بداية عمان', judge: SECRET.judge, notes: SECRET.sessionNote },
  })
  await prisma.invoice.create({
    data: { number: 'CIT-INV-1', amount: '150.500', paid: '0', clientId: client.id, caseId: kase.id, officeId, notes: SECRET.invoiceNote },
  })

  citizen = await createColleague(officeId, { role: Role.CITIZEN, clientId: client.id })
})

afterAll(async () => {
  await cleanupOffice(officeId)
})

function assertOnlyAllowedKeys(rows: Record<string, unknown>[], allowed: readonly string[]) {
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    const extra = Object.keys(row).filter((k) => !allowed.includes(k))
    expect(extra, `unexpected citizen-visible fields: ${extra.join(', ')}`).toEqual([])
  }
}

function assertNoSecrets(json: string) {
  for (const value of Object.values(SECRET)) expect(json).not.toContain(value)
  for (const key of ['"notes"', '"ownerId"', '"lawyerId"', '"officeId"', '"judge"', '"paymentRecordedAt"']) {
    expect(json).not.toContain(key)
  }
}

describe('citizen portal — explicit field allow-lists', () => {
  it('cases: only allow-listed fields; no internal notes, no ownership ids, no other client\'s case', async () => {
    const res = await citizenCases(testRequest('/api/citizen/cases', { user: citizen }))
    expect(res.status).toBe(200)
    const text = await res.text()
    const rows = JSON.parse(text)
    assertOnlyAllowedKeys(rows, CITIZEN_ALLOWED_KEYS.case)
    assertNoSecrets(text)
    expect(rows.map((r: { number: string }) => r.number)).toEqual(['CIT-1'])
    // Nested upcoming sessions are allow-listed too.
    expect(Object.keys(rows[0].sessions[0]).sort()).toEqual(['court', 'date', 'id', 'status', 'time'])
  })

  it('sessions: no session notes, no judge', async () => {
    const res = await citizenSessions(testRequest('/api/citizen/sessions', { user: citizen }))
    expect(res.status).toBe(200)
    const text = await res.text()
    assertOnlyAllowedKeys(JSON.parse(text), CITIZEN_ALLOWED_KEYS.session)
    assertNoSecrets(text)
  })

  it('invoices: no invoice notes; money as exact numbers', async () => {
    const res = await citizenInvoices(testRequest('/api/citizen/invoices', { user: citizen }))
    expect(res.status).toBe(200)
    const text = await res.text()
    const rows = JSON.parse(text)
    assertOnlyAllowedKeys(rows, CITIZEN_ALLOWED_KEYS.invoice)
    assertNoSecrets(text)
    expect(rows[0].amount).toBe(150.5)
    expect(rows[0].paid).toBe(0)
  })

  it('staff still see the internal notes (the allow-list is citizen-only)', async () => {
    const text = await (await staffCases(testRequest('/api/cases', { user: lawyer }))).text()
    expect(text).toContain(SECRET.caseNote)
  })

  it('a citizen cannot use staff endpoints', async () => {
    expect((await staffCases(testRequest('/api/cases', { user: citizen }))).status).toBe(403)
  })

  it('once the office deactivates the client, the portal login stops working', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { active: false } })
    try {
      for (const handler of [citizenCases, citizenSessions, citizenInvoices]) {
        expect((await handler(testRequest('/api/citizen/x', { user: citizen }))).status).toBe(403)
      }
    } finally {
      await prisma.client.update({ where: { id: clientId }, data: { active: true } })
    }
    expect((await readJson(await citizenCases(testRequest('/api/citizen/cases', { user: citizen })))).length).toBe(1)
  })
})
