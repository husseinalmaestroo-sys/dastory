import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/jwt'
import { generateTotpCode, generateTotpSecret } from '@/lib/totp'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as setup2fa, PATCH as enable2fa } from '@/app/api/auth/2fa/route'
import { POST as verify2fa } from '@/app/api/auth/2fa/verify/route'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest, type TestUser } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function trackedUser(opts: Parameters<typeof createTestOfficeUser>[0] = {}) {
  const user = await createTestOfficeUser(opts)
  createdOffices.push(user.officeId)
  return user
}

describe('login', () => {
  it('succeeds with correct credentials and sets a session cookie', async () => {
    const user = await trackedUser({ password: 'CorrectHorseBattery1' })
    const res = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'CorrectHorseBattery1' } }))

    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.user.email).toBe(user.email)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('ds_token=')
  })

  it('rejects an incorrect password with a generic message', async () => {
    const user = await trackedUser({ password: 'CorrectHorseBattery1' })
    const res = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'WrongPassword' } }))

    expect(res.status).toBe(401)
    const body = await readJson(res)
    expect(body.error).toBeTruthy()
  })

  it('rejects a nonexistent email with the SAME generic message (no user enumeration)', async () => {
    const user = await trackedUser({ password: 'CorrectHorseBattery1' })
    const wrongPasswordRes = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'nope' } }))
    const noSuchUserRes = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: 'nobody-here@example.jo', password: 'nope' } }))

    expect(wrongPasswordRes.status).toBe(noSuchUserRes.status)
    expect((await readJson(wrongPasswordRes)).error).toBe((await readJson(noSuchUserRes)).error)
  })

  it('rejects login for a deactivated user', async () => {
    const user = await trackedUser({ password: 'CorrectHorseBattery1' })
    await prisma.user.update({ where: { id: user.id }, data: { active: false } })

    const res = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'CorrectHorseBattery1' } }))
    expect(res.status).toBe(401)
  })
})

describe('2FA', () => {
  it('setup -> enable -> login now requires 2FA -> verify completes with a full session', async () => {
    const user = await trackedUser({ password: 'CorrectHorseBattery1' })

    const setupRes = await setup2fa(testRequest('/api/auth/2fa', { method: 'POST', user }))
    expect(setupRes.status).toBe(200)
    const { manualKey } = await readJson(setupRes)
    const secret = manualKey.replace(/\s/g, '')

    // DB must never hold the raw secret.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorSecret: true } })
    expect(stored.twoFactorSecret?.startsWith('v1:')).toBe(true)
    expect(stored.twoFactorSecret).not.toContain(secret)

    const code = totpCodeFor(secret)
    const enableRes = await enable2fa(testRequest('/api/auth/2fa', { method: 'PATCH', user, body: { code } }))
    expect(enableRes.status).toBe(200)

    const loginRes = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'CorrectHorseBattery1' } }))
    const loginBody = await readJson(loginRes)
    expect(loginBody.requires2FA).toBe(true)
    const pendingCookie = extractCookie(loginRes)

    const verifyRes = await verify2fa(testRequest('/api/auth/2fa/verify', { method: 'POST', headers: { Cookie: pendingCookie }, body: { code: totpCodeFor(secret) } }))
    expect(verifyRes.status).toBe(200)
    const fullCookie = extractCookie(verifyRes)
    const payload = verifyToken(fullCookie.replace('ds_token=', ''))
    expect(payload?.twoFactorVerified).toBe(true)
  })

  it('rejects an incorrect code when enabling', async () => {
    const user = await trackedUser()
    await setup2fa(testRequest('/api/auth/2fa', { method: 'POST', user }))
    const res = await enable2fa(testRequest('/api/auth/2fa', { method: 'PATCH', user, body: { code: '000000' } }))
    expect(res.status).toBe(400)
  })

  it('migrates a legacy plaintext secret transparently on login verify', async () => {
    const rawSecret = generateTotpSecret()
    const user = await trackedUser({ twoFactorEnabled: true, twoFactorSecret: rawSecret }) // plaintext, pre-migration shape

    const code = totpCodeFor(rawSecret)
    const loginRes = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'TestPassw0rd!23' } }))
    const pendingCookie = extractCookie(loginRes)
    const verifyRes = await verify2fa(testRequest('/api/auth/2fa/verify', { method: 'POST', headers: { Cookie: pendingCookie }, body: { code } }))

    expect(verifyRes.status).toBe(200)
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorSecret: true } })
    expect(stored.twoFactorSecret?.startsWith('v1:')).toBe(true) // migrated in place
  })
})

describe('password reset', () => {
  it('forgot-password always returns the generic message, whether or not the email exists', async () => {
    const user = await trackedUser()
    const existing = await forgotPassword(testRequest('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } }))
    const missing = await forgotPassword(testRequest('/api/auth/forgot-password', { method: 'POST', body: { email: 'nobody@example.jo' } }))

    expect(existing.status).toBe(200)
    expect(missing.status).toBe(200)
    expect((await readJson(existing)).message).toBe((await readJson(missing)).message)
  })

  it('forgot-password creates a reset token only for an existing active user', async () => {
    const user = await trackedUser()
    await forgotPassword(testRequest('/api/auth/forgot-password', { method: 'POST', body: { email: user.email } }))
    const tokens = await prisma.passwordResetToken.count({ where: { userId: user.id } })
    expect(tokens).toBe(1)
  })

  it('a valid token resets the password and logs out other sessions (sessionVersion bump)', async () => {
    const user = await trackedUser({ password: 'OldPassword1' })
    const rawToken = await insertResetToken(user)

    const res = await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'NewPassword2!' } }))
    expect(res.status).toBe(200)

    const oldLogin = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'OldPassword1' } }))
    expect(oldLogin.status).toBe(401)
    const newLogin = await login(testRequest('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'NewPassword2!' } }))
    expect(newLogin.status).toBe(200)

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(dbUser.sessionVersion).toBeGreaterThan(user.sessionVersion)
  })

  it('rejects a token that was already used', async () => {
    const user = await trackedUser({ password: 'OldPassword1' })
    const rawToken = await insertResetToken(user)
    await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'NewPassword2!' } }))

    const secondAttempt = await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'AnotherOne3!' } }))
    expect(secondAttempt.status).toBe(400)
  })

  it('rejects an expired token', async () => {
    const user = await trackedUser({ password: 'OldPassword1' })
    const rawToken = await insertResetToken(user, { expired: true })

    const res = await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'NewPassword2!' } }))
    expect(res.status).toBe(400)
  })

  it('rejects an unrecognized token', async () => {
    const res = await resetPassword(testRequest('/api/auth/reset-password', { method: 'POST', body: { token: 'not-a-real-token', password: 'NewPassword2!' } }))
    expect(res.status).toBe(400)
  })
})

// Generates a code the same way the app's own totp.ts (and thus a real
// authenticator app) would — verifyTotpCode checks a ±1-step window around
// "now", and test execution is fast enough that this always lands inside it.
function totpCodeFor(secret: string): string {
  return generateTotpCode(secret)
}

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  const match = /ds_token=[^;]+/.exec(raw)
  if (!match) throw new Error('no ds_token cookie in response')
  return match[0]
}

async function insertResetToken(user: TestUser, opts: { expired?: boolean } = {}): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + (opts.expired ? -60_000 : 30 * 60_000)),
    },
  })
  return rawToken
}
