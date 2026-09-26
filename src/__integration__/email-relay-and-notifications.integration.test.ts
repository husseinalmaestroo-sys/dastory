// The dashboard email relay sends mail from the platform's own SMTP identity,
// so it is gated beyond "is the recipient related to you" (see
// email-authorization.integration.test.ts): a verified sender, an active
// client, a per-office daily cap, and no header injection through the
// subject. Plus: in-app notifications never fail on long user text.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as sendEmail, OFFICE_DAILY_EMAIL_CAP } from '@/app/api/email/send/route'
import { notifyUser } from '@/lib/notify'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest } from './helpers'

const sent: { to: string; subject: string }[] = []
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: { to: string; subject: string }) => { sent.push(msg); return { messageId: 'test' } },
    }),
  },
}))

const smtp = { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'u', SMTP_PASS: 'p' }
beforeEach(() => { Object.assign(process.env, smtp); sent.length = 0 })
afterEach(() => { for (const k of Object.keys(smtp)) delete process.env[k] })

const createdOffices: string[] = []
afterAll(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function senderWithClient(opts: { emailVerified?: boolean; role?: Role } = {}) {
  const user = await createTestOfficeUser({ role: Role.OFFICE_MANAGER, ...opts })
  createdOffices.push(user.officeId)
  const client = await prisma.client.create({
    data: { name: 'Relay Client', email: `client-${user.id}@example.jo`, officeId: user.officeId, ownerId: user.id },
  })
  return { user, client }
}

const send = (user: Awaited<ReturnType<typeof senderWithClient>>['user'], to: string, subject = 'Hearing date') =>
  sendEmail(testRequest('/api/email/send', { method: 'POST', user, body: { to, subject, body: 'Your hearing is on Monday.' } }))

describe('email relay gates', () => {
  it('positive control: a verified manager can email their active client', async () => {
    const { user, client } = await senderWithClient()
    expect((await send(user, client.email!)).status).toBe(200)
    expect(sent.map((m) => m.to)).toEqual([client.email])
  })

  it('an unverified sender is refused before anything is sent', async () => {
    const { user, client } = await senderWithClient({ emailVerified: false })
    const res = await send(user, client.email!)
    expect(res.status).toBe(403)
    expect((await readJson(res)).code).toBe('email_not_verified')
    expect(sent).toHaveLength(0)
  })

  it('for a lawyer, a deactivated client is no longer a valid recipient', async () => {
    // (Managers keep the documented manager override — any address, still
    // bounded by the verified-email gate and the office daily cap.)
    const { user, client } = await senderWithClient({ role: Role.LAWYER })
    expect((await send(user, client.email!)).status).toBe(200)
    await prisma.client.update({ where: { id: client.id }, data: { active: false } })
    expect((await send(user, client.email!)).status).toBe(403)
    expect(sent).toHaveLength(1)
  })

  it(`the office daily cap (${OFFICE_DAILY_EMAIL_CAP}) stops the relay being used for bulk mail`, async () => {
    const { user, client } = await senderWithClient()
    await prisma.auditLog.createMany({
      data: Array.from({ length: OFFICE_DAILY_EMAIL_CAP }, () => ({ officeId: user.officeId, actorId: user.id, action: 'email.sent' })),
    })
    const res = await send(user, client.email!)
    expect(res.status).toBe(429)
    expect(sent).toHaveLength(0)
  })

  it('CR/LF in the subject cannot inject extra mail headers', async () => {
    const { user, client } = await senderWithClient()
    const res = await send(user, client.email!, 'Hello\r\nBcc: victim@example.com\r\nX-Evil: 1')
    expect(res.status).toBe(200)
    expect(sent[0].subject).not.toMatch(/[\r\n]/)
  })
})

describe('in-app notifications', () => {
  it('long user-supplied text is fitted, never fails the insert (it used to vanish silently)', async () => {
    const { user } = await senderWithClient()
    await notifyUser(user.id, user.officeId, 'T'.repeat(500), `تم رفع مستند: ${'م'.repeat(5000)}`)
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } })
    expect(row.title.length).toBeLessThanOrEqual(191)
    expect(row.body.length).toBeLessThanOrEqual(2000)
    expect(row.body.startsWith('تم رفع مستند')).toBe(true)
  })
})
