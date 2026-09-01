import { afterEach, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as sendEmail } from '@/app/api/email/send/route'
import { cleanupOffice, createColleague, createTestOfficeUser, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser(role: Role = Role.LAWYER) {
  const user = await createTestOfficeUser({ role })
  createdOffices.push(user.officeId)
  return user
}

const validBody = { subject: 'Test subject', body: 'Test body content' }

describe('email relay authorization — route level (real DB lookups)', () => {
  it('allows a lawyer to email a client visible to them (passes auth, then 503s on missing SMTP config — proving it got past the authorization check)', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    const client = await prisma.client.create({ data: { name: 'Real Client', email: 'client@example.jo', officeId: lawyer.officeId, ownerId: lawyer.id } })

    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: client.email } }))
    expect(res.status).toBe(503) // SMTP isn't configured in the test env — 503 proves authorization was NOT the blocker
  })

  it('allows a lawyer to email a colleague in the same office', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    const colleague = await createColleague(lawyer.officeId, { role: Role.LAWYER })

    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: colleague.email } }))
    expect(res.status).toBe(503)
  })

  it('denies a lawyer emailing an unassociated external address', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: 'stranger@somewhere-else.jo' } }))
    expect(res.status).toBe(403)
  })

  it('denies a lawyer emailing a client that belongs to a DIFFERENT office (cross-tenant)', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    const otherOffice = await trackedUser(Role.OFFICE_MANAGER)
    const otherClient = await prisma.client.create({ data: { name: 'Other Office Client', email: 'other-client@example.jo', officeId: otherOffice.officeId, ownerId: otherOffice.id } })

    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: otherClient.email } }))
    expect(res.status).toBe(403)
  })

  it('allows an office manager to email an arbitrary external address (manager override)', async () => {
    const manager = await trackedUser(Role.OFFICE_MANAGER)
    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: manager, body: { ...validBody, to: 'anyone@anywhere.jo' } }))
    expect(res.status).toBe(503) // past authorization, blocked only by missing SMTP config
  })

  it('denies a CITIZEN role outright', async () => {
    const manager = await trackedUser(Role.OFFICE_MANAGER)
    const client = await prisma.client.create({ data: { name: 'Citizen\'s Client Record', officeId: manager.officeId, ownerId: manager.id } })
    const citizen = await createColleague(manager.officeId, { role: Role.CITIZEN, clientId: client.id })

    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: citizen, body: { ...validBody, to: 'anyone@anywhere.jo' } }))
    expect(res.status).toBe(403) // requireOfficeUser rejects CITIZEN before authorization logic even runs
  })

  it('audit-logs a blocked attempt with the reason', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: 'blocked@nowhere.jo' } }))

    const log = await prisma.auditLog.findFirst({ where: { actorId: lawyer.id, action: 'email.send_blocked' }, orderBy: { createdAt: 'desc' } })
    expect(log).not.toBeNull()
    expect((log?.metadata as Record<string, unknown>)?.reason).toBe('recipient_not_associated')
  })

  it('rejects malformed recipient addresses before any DB lookup', async () => {
    const lawyer = await trackedUser(Role.LAWYER)
    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: lawyer, body: { ...validBody, to: 'not-an-email' } }))
    expect(res.status).toBe(400)
  })

  // Launch plan item 03: with no SMTP configured the route must 503 with an
  // error — never a fabricated success — and record the honest failure.
  it('503s with an error (not a fake "sent") and audit-logs smtp_not_configured when SMTP is unset', async () => {
    const manager = await trackedUser(Role.OFFICE_MANAGER) // manager override — reaches the SMTP check for any recipient
    const res = await sendEmail(testRequest('/api/email/send', { method: 'POST', user: manager, body: { ...validBody, to: 'someone@external.example' } }))

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toHaveProperty('error')
    expect(json).not.toHaveProperty('ok')

    const log = await prisma.auditLog.findFirst({
      where: { actorId: manager.id, action: 'email.send_failed' },
      orderBy: { createdAt: 'desc' },
    })
    expect(log).not.toBeNull()
    expect((log?.metadata as Record<string, unknown>)?.reason).toBe('smtp_not_configured')
  })
})
