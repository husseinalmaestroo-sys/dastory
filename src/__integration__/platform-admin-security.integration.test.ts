// Platform admin can never be obtained through public signup — only through
// operator provisioning (scripts/platform-admin.mjs) PLUS an allow-listed,
// verified, 2FA-protected account. Previously any self-signup with the
// default/allow-listed address became platform admin.
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as signup } from '@/app/api/auth/signup/route'
import { GET as me } from '@/app/api/auth/me/route'
import { GET as adminOverview } from '@/app/api/admin/overview/route'
import { GET as trialRequestsGet } from '@/app/api/trial-requests/route'
import { PATCH as siteSettingsPatch } from '@/app/api/site-settings/route'
import { POST as adminSuspend } from '@/app/api/admin/offices/[officeId]/suspend/route'
import { cleanupOffice, createPlatformAdmin, createTestOfficeUser, readJson, testParams, testRequest, type TestUser } from './helpers'

const createdOffices: string[] = []
afterAll(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

/** Every platform-admin-only endpoint, called as `user`. */
async function adminEndpointStatuses(user: TestUser, victimOfficeId: string) {
  return {
    overview: (await adminOverview(testRequest('/api/admin/overview', { user }))).status,
    trialRequests: (await trialRequestsGet(testRequest('/api/trial-requests', { user }))).status,
    siteSettings: (await siteSettingsPatch(testRequest('/api/site-settings', { method: 'PATCH', user, body: { contactPhone: '+962 7 0000 0000' } }))).status,
    suspend: (await adminSuspend(testRequest(`/api/admin/offices/${victimOfficeId}/suspend`, { method: 'POST', user }), testParams({ officeId: victimOfficeId }))).status,
  }
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  const token = /ds_token=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error('no session cookie issued')
  return `ds_token=${token}`
}

describe('platform admin cannot be self-claimed', () => {
  it('signing up with an ALLOW-LISTED admin email does not make you platform admin', async () => {
    // Free the address (the helper-created admin may hold it from another file).
    const leftover = await prisma.user.findUnique({ where: { email: 'admin@dostoori.jo' }, select: { officeId: true } })
    if (leftover) await cleanupOffice(leftover.officeId)
    const victim = await createTestOfficeUser()
    createdOffices.push(victim.officeId)

    const res = await signup(testRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Attacker', officeName: 'Attacker Office', email: 'admin@dostoori.jo', password: 'Str0ngPassw0rd!' },
    }))
    expect(res.status).toBe(201)
    const body = await readJson(res)
    createdOffices.push(body.user.officeId)
    expect(body.user.isPlatformAdmin).toBe(false)

    const attacker = { cookie: cookieFrom(res) } as TestUser
    const meBody = await readJson(await me(testRequest('/api/auth/me', { user: attacker })))
    expect(meBody.user.isPlatformAdmin).toBe(false)

    const statuses = await adminEndpointStatuses(attacker, victim.officeId)
    expect(statuses).toEqual({ overview: 403, trialRequests: 403, siteSettings: 403, suspend: 403 })

    // The victim office was not suspended.
    const sub = await prisma.subscription.findUnique({ where: { officeId: victim.officeId } })
    expect(sub?.status).not.toBe('CANCELED')
  })

  it('an operator-provisioned, allow-listed account WITHOUT a verified email is refused (with the reason)', async () => {
    const admin = await createPlatformAdmin({ emailVerified: false })
    createdOffices.push(admin.officeId)
    const res = await adminOverview(testRequest('/api/admin/overview', { user: admin }))
    expect(res.status).toBe(403)
    expect((await readJson(res)).code).toBe('platform_admin_requirements')
  })

  it('an operator-provisioned, allow-listed, verified account WITHOUT 2FA is refused', async () => {
    const admin = await createPlatformAdmin({ twoFactorEnabled: false })
    createdOffices.push(admin.officeId)
    const victim = await createTestOfficeUser()
    createdOffices.push(victim.officeId)
    expect(await adminEndpointStatuses(admin, victim.officeId)).toEqual({ overview: 403, trialRequests: 403, siteSettings: 403, suspend: 403 })
  })

  it('verified + 2FA + allow-listed but NOT provisioned by the operator is refused', async () => {
    const admin = await createPlatformAdmin({ isPlatformAdmin: false })
    createdOffices.push(admin.officeId)
    const res = await adminOverview(testRequest('/api/admin/overview', { user: admin }))
    expect(res.status).toBe(403)
    expect((await readJson(res)).code).toBeUndefined() // generic 403 — nothing to hint at
  })

  it('provisioned + verified + 2FA but email NOT in PLATFORM_ADMIN_EMAILS is refused', async () => {
    const admin = await createPlatformAdmin({ email: `not-listed-${Date.now()}@example.jo` })
    createdOffices.push(admin.officeId)
    expect((await adminOverview(testRequest('/api/admin/overview', { user: admin }))).status).toBe(403)
  })

  it('a 2FA-enabled admin whose session has NOT completed the second factor is not even authenticated', async () => {
    const admin = await createPlatformAdmin()
    createdOffices.push(admin.officeId)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    const { signToken } = await import('@/lib/jwt')
    const pending = signToken({
      id: user.id, email: user.email, name: user.name, role: user.role, officeId: user.officeId,
      clientId: null, sessionVersion: user.sessionVersion, twoFactorVerified: false,
    })
    const res = await adminOverview(testRequest('/api/admin/overview', { user: { cookie: `ds_token=${pending}` } as TestUser }))
    expect(res.status).toBe(401)
  })

  it('positive control: a fully qualified platform admin is accepted', async () => {
    const admin = await createPlatformAdmin()
    createdOffices.push(admin.officeId)
    expect((await adminOverview(testRequest('/api/admin/overview', { user: admin }))).status).toBe(200)
    const meBody = await readJson(await me(testRequest('/api/auth/me', { user: admin })))
    expect(meBody.user.isPlatformAdmin).toBe(true)
  })

  it('no HTTP route can set User.isPlatformAdmin — signup ignores a smuggled flag', async () => {
    const email = `smuggle-${Date.now()}@example.jo`
    const res = await signup(testRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Smuggler', email, password: 'Str0ngPassw0rd!', isPlatformAdmin: true, role: 'OFFICE_MANAGER', emailVerified: true },
    }))
    expect(res.status).toBe(201)
    const created = await prisma.user.findUniqueOrThrow({ where: { email } })
    createdOffices.push(created.officeId)
    expect(created.isPlatformAdmin).toBe(false)
    expect(created.emailVerified).toBe(false)
  })
})
