// Session lifecycle and email-link security.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { GET as me } from '@/app/api/auth/me/route'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'
import { PATCH as teamPatch } from '@/app/api/team/route'
import { GET as casesList } from '@/app/api/cases/route'
import { cleanupOffice, createColleague, createTestOfficeUser, randomTestIp, readJson, testRequest, type TestUser } from './helpers'

// Captures outgoing mail instead of sending it.
const sent: { to: string; html: string; text: string }[] = []
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (msg: { to: string; html: string; text: string }) => { sent.push(msg); return { messageId: 'test' } },
    }),
  },
}))

const PASSWORD = 'TestPassw0rd!23'
const createdOffices: string[] = []
afterAll(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

function cookieFrom(res: Response): string {
  const token = /ds_token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  if (!token) throw new Error('no session cookie issued')
  return `ds_token=${token}`
}

async function loginAs(email: string, ip = randomTestIp()) {
  return login(testRequest('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD }, ip }))
}

describe('logout revokes the session server-side', () => {
  it('a token captured before logout is rejected after it', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    const res = await loginAs(user.email)
    expect(res.status).toBe(200)
    const captured = { cookie: cookieFrom(res) } as TestUser

    expect((await me(testRequest('/api/auth/me', { user: captured }))).status).toBe(200)
    const out = await logout(testRequest('/api/auth/logout', { method: 'POST', user: captured }))
    expect(out.status).toBe(200)
    // Cookie cleared with the same security attributes it was set with.
    expect(out.headers.get('set-cookie')).toMatch(/ds_token=;.*HttpOnly/i)

    // Replaying the captured token: rejected everywhere.
    expect((await me(testRequest('/api/auth/me', { user: captured }))).status).toBe(401)
    expect((await casesList(testRequest('/api/cases', { user: captured }))).status).toBe(401)
  })

  it('logout with no/invalid cookie is a harmless 200', async () => {
    expect((await logout(testRequest('/api/auth/logout', { method: 'POST' }))).status).toBe(200)
    expect((await logout(testRequest('/api/auth/logout', { method: 'POST', user: { cookie: 'ds_token=garbage' } as TestUser }))).status).toBe(200)
  })

  it('a stale (already revoked) token cannot log out the user\'s newer session', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    const first = { cookie: cookieFrom(await loginAs(user.email)) } as TestUser
    await logout(testRequest('/api/auth/logout', { method: 'POST', user: first }))
    const second = { cookie: cookieFrom(await loginAs(user.email)) } as TestUser
    await logout(testRequest('/api/auth/logout', { method: 'POST', user: first })) // replay the dead one
    expect((await me(testRequest('/api/auth/me', { user: second }))).status).toBe(200)
  })
})

describe('deactivation revokes sessions for good', () => {
  it('a deactivated lawyer is locked out, and reactivation does NOT revive the old token', async () => {
    const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
    createdOffices.push(manager.officeId)
    const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
    expect((await me(testRequest('/api/auth/me', { user: lawyer }))).status).toBe(200)

    expect((await teamPatch(testRequest('/api/team', { method: 'PATCH', user: manager, body: { id: lawyer.id, active: false } }))).status).toBe(200)
    expect((await me(testRequest('/api/auth/me', { user: lawyer }))).status).toBe(401)

    expect((await teamPatch(testRequest('/api/team', { method: 'PATCH', user: manager, body: { id: lawyer.id, active: true } }))).status).toBe(200)
    expect((await me(testRequest('/api/auth/me', { user: lawyer }))).status).toBe(401)
  })
})

describe('email links use the configured APP_URL, never the request Host', () => {
  const smtp = { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'u', SMTP_PASS: 'p' }
  beforeEach(() => { Object.assign(process.env, smtp); sent.length = 0 })
  afterEach(() => { for (const k of Object.keys(smtp)) delete process.env[k] })

  it('a forged Host header does not change the reset link\'s origin', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    const res = await forgotPassword(testRequest('/api/auth/forgot-password', {
      method: 'POST', body: { email: user.email },
      // A direct request (e.g. curl) with a self-consistent forged Host/Origin
      // pair gets past the CSRF origin check — the link must still be ours.
      headers: { Host: 'attacker.example', Origin: 'http://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'http' },
    }))
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1)
    const link = /https?:\/\/[^\s"<]+resetToken=[a-f0-9]+/.exec(sent[0].text)?.[0]
    expect(link).toBeDefined()
    expect(link!.startsWith('https://app.dostoori.test/login?resetToken=')).toBe(true)
    expect(sent[0].text + sent[0].html).not.toContain('attacker.example')
  })

  it('completing a reset marks the email verified and revokes existing sessions', async () => {
    const user = await createTestOfficeUser({ emailVerified: false })
    createdOffices.push(user.officeId)
    await forgotPassword(testRequest('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } }))
    const token = /resetToken=([a-f0-9]+)/.exec(sent[0].text)![1]
    const res = await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token, password: 'N3wPassw0rd!45' } }))
    expect(res.status).toBe(200)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.emailVerified).toBe(true)
    expect((await me(testRequest('/api/auth/me', { user }))).status).toBe(401)
  })
})

describe('bearer tokens never reach the logs', () => {
  it('with SMTP unconfigured, neither the reset link nor the token is logged', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const res = await forgotPassword(testRequest('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } }))
      expect(res.status).toBe(200)
      const logged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')
      expect(logged).not.toMatch(/resetToken=/)
      expect(logged).not.toMatch(/[a-f0-9]{64}/)
      expect(logged).toContain('email NOT sent')
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })
})

describe('per-account login throttling (independent of client IP)', () => {
  it('10 failed passwords from 10 different IPs lock the account; the right password is then refused too', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    for (let i = 0; i < 10; i++) {
      const res = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: `wrong-${i}` }, ip: randomTestIp() }))
      expect(res.status).toBe(401)
    }
    const locked = await loginAs(user.email)
    expect(locked.status).toBe(429)
    expect((await readJson(locked)).code).toBe('account_throttled')
  })

  it('a successful login clears the failure count', async () => {
    const user = await createTestOfficeUser()
    createdOffices.push(user.officeId)
    for (let i = 0; i < 9; i++) {
      await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'wrong' }, ip: randomTestIp() }))
    }
    expect((await loginAs(user.email)).status).toBe(200)
    for (let i = 0; i < 9; i++) {
      await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'wrong' }, ip: randomTestIp() }))
    }
    expect((await loginAs(user.email)).status).toBe(200)
  })
})
