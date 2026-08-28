import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { POST as verifyEmail } from '@/app/api/auth/verify-email/route'
import { POST as resendVerification } from '@/app/api/auth/verify-email/resend/route'
import { POST as sendEmail } from '@/app/api/email/send/route'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser(emailVerified: boolean) {
  const user = await createTestOfficeUser({ emailVerified })
  createdOffices.push(user.officeId)
  return user
}

async function insertVerificationToken(userId: string, opts: { expired?: boolean; used?: boolean } = {}) {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: opts.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60_000),
      usedAt: opts.used ? new Date() : null,
    },
  })
  return rawToken
}

describe('email verification', () => {
  it('a valid token marks the account verified', async () => {
    const user = await trackedUser(false)
    const token = await insertVerificationToken(user.id)

    const res = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(res.status).toBe(200)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.emailVerified).toBe(true)
  })

  it('rejects an already-used token', async () => {
    const user = await trackedUser(false)
    const token = await insertVerificationToken(user.id, { used: true })

    const res = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(res.status).toBe(400)
  })

  it('rejects an expired token', async () => {
    const user = await trackedUser(false)
    const token = await insertVerificationToken(user.id, { expired: true })

    const res = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(res.status).toBe(400)
  })

  it('rejects a token that never existed', async () => {
    const res = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token: 'not-a-real-token' } }))
    expect(res.status).toBe(400)
  })

  it('a token cannot be consumed twice', async () => {
    const user = await trackedUser(false)
    const token = await insertVerificationToken(user.id)

    const first = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(first.status).toBe(200)

    const second = await verifyEmail(testRequest('/api/auth/verify-email', { method: 'POST', body: { token } }))
    expect(second.status).toBe(400)
  })

  it('resend requires authentication', async () => {
    const res = await resendVerification(testRequest('/api/auth/verify-email/resend', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('resend refuses an already-verified account', async () => {
    const user = await trackedUser(true)
    const res = await resendVerification(testRequest('/api/auth/verify-email/resend', { method: 'POST', user }))
    expect(res.status).toBe(400)
  })

  it('resend issues a new token for an unverified account (logged, since no SMTP in test env)', async () => {
    const user = await trackedUser(false)
    const before = await prisma.emailVerificationToken.count({ where: { userId: user.id } })

    const res = await resendVerification(testRequest('/api/auth/verify-email/resend', { method: 'POST', user }))
    expect(res.status).toBe(200)

    const after = await prisma.emailVerificationToken.count({ where: { userId: user.id } })
    expect(after).toBe(before + 1)
  })

  it('an unverified account cannot use the email relay, even to an otherwise-authorized recipient', async () => {
    const user = await trackedUser(false)
    const colleague = await prisma.client.create({ data: { name: 'Client', email: 'c@example.jo', officeId: user.officeId, ownerId: user.id } })

    const res = await sendEmail(testRequest('/api/email/send', {
      method: 'POST', user, body: { to: colleague.email, subject: 'Test', body: 'Test body' },
    }))
    expect(res.status).toBe(403)
    expect((await readJson(res)).error).toContain('تأكيد')
  })

  it('a verified account passes the verification gate (blocked only by missing SMTP in test env)', async () => {
    const user = await trackedUser(true)
    const client = await prisma.client.create({ data: { name: 'Client', email: 'c2@example.jo', officeId: user.officeId, ownerId: user.id } })

    const res = await sendEmail(testRequest('/api/email/send', {
      method: 'POST', user, body: { to: client.email, subject: 'Test', body: 'Test body' },
    }))
    expect(res.status).toBe(503) // past both authorization AND verification checks
  })
})
