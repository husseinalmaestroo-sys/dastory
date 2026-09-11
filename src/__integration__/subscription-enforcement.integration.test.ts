// Launch plan item 06 — "an unpaid office is actually limited."
//
// getOfficeBillingStatus (billing.ts) already reported a real status; this
// is the consequence side: getSubscriptionEnforcement turns that status into
// a tier (active / grace / blocked), and requireOfficeUser (auth-server.ts)
// applies it to every office-scoped route automatically. /api/clients here
// stands in for "any office write/read route" — the gate lives in the shared
// auth helper, not per-route, so one resource is enough to prove it.
import { afterAll, describe, expect, it } from 'vitest'
import { Role, type SubscriptionStatus } from '@prisma/client'
import { GET as clientsList, POST as clientsCreate } from '@/app/api/clients/route'
import { GET as billingStatus } from '@/app/api/billing/status/route'
import { GET as officeExport } from '@/app/api/office/export/route'
import { POST as adminActivate } from '@/app/api/admin/offices/[officeId]/activate/route'
import { POST as adminSuspend } from '@/app/api/admin/offices/[officeId]/suspend/route'
import { POST as adminExtendTrial } from '@/app/api/admin/offices/[officeId]/extend-trial/route'
import { cleanupOffice, createTestOfficeUser, readJson, testParams, testRequest, type TestUser } from './helpers'
import { prisma } from '@/lib/prisma'

const DAY = 24 * 60 * 60_000
const createdOffices: string[] = []
const ORIGINAL_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS

afterAll(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
  if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.PLATFORM_ADMIN_EMAILS
  else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
})

async function officeWithSubscription(
  status: SubscriptionStatus,
  overrides: { trialEndsAt?: Date; currentPeriodEnd?: Date } = {}
): Promise<TestUser & { officeId: string }> {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(manager.officeId)
  const plan = await prisma.plan.upsert({
    where: { key: 'basic' },
    create: { key: 'basic', name: 'الباقة الأساسية', maxUsers: 5, maxCases: 200, aiCallsPerMonth: 100 },
    update: {},
  })
  await prisma.subscription.create({ data: { officeId: manager.officeId, planId: plan.id, status, ...overrides } })
  return manager
}

async function asPlatformAdmin<T>(fn: (admin: TestUser) => Promise<T>): Promise<T> {
  const admin = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(admin.officeId)
  process.env.PLATFORM_ADMIN_EMAILS = admin.email
  try {
    return await fn(admin)
  } finally {
    delete process.env.PLATFORM_ADMIN_EMAILS
  }
}

describe('subscription enforcement — grace blocks writes, the full wall blocks everything', () => {
  it('TRIALING past trialEndsAt (yesterday): a write 402s as subscription_expired, a read still 200s (grace)', async () => {
    const manager = await officeWithSubscription('TRIALING', { trialEndsAt: new Date(Date.now() - DAY) })

    const writeRes = await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'Blocked Client' } }))
    expect(writeRes.status).toBe(402)
    expect((await readJson(writeRes)).code).toBe('subscription_expired')

    expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(200)
  })

  it('past the 7-day grace window, reads are blocked too (the full wall)', async () => {
    const manager = await officeWithSubscription('TRIALING', { trialEndsAt: new Date(Date.now() - 8 * DAY) })

    expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(402)
    expect((await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'x' } }))).status).toBe(402)
  })

  it('PAST_DUE follows the same grace-then-wall rule, anchored on currentPeriodEnd', async () => {
    const grace = await officeWithSubscription('PAST_DUE', { currentPeriodEnd: new Date(Date.now() - DAY) })
    expect((await clientsList(testRequest('/api/clients', { user: grace }))).status).toBe(200)
    expect((await clientsCreate(testRequest('/api/clients', { method: 'POST', user: grace, body: { name: 'x' } }))).status).toBe(402)

    const wall = await officeWithSubscription('PAST_DUE', { currentPeriodEnd: new Date(Date.now() - 8 * DAY) })
    expect((await clientsList(testRequest('/api/clients', { user: wall }))).status).toBe(402)
  })

  it('CANCELED has no grace at all — an immediate full wall', async () => {
    const manager = await officeWithSubscription('CANCELED')
    expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(402)
    expect((await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'x' } }))).status).toBe(402)
  })

  it('ACTIVE, and an office with no Subscription row at all, are never gated', async () => {
    const active = await officeWithSubscription('ACTIVE', { currentPeriodEnd: new Date(Date.now() + 30 * DAY) })
    expect((await clientsList(testRequest('/api/clients', { user: active }))).status).toBe(200)

    const noSub = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
    createdOffices.push(noSub.officeId)
    expect((await clientsList(testRequest('/api/clients', { user: noSub }))).status).toBe(200)
  })

  it('GET /api/billing/status and GET /api/office/export bypass the gate even when blocked', async () => {
    const manager = await officeWithSubscription('CANCELED')
    expect((await billingStatus(testRequest('/api/billing/status', { user: manager }))).status).toBe(200)
    expect((await officeExport(testRequest('/api/office/export', { user: manager }))).status).toBe(200)
  })

  it('a platform admin is exempt from their own office\'s subscription state', async () => {
    await asPlatformAdmin(async (admin) => {
      await prisma.subscription.create({
        data: {
          officeId: admin.officeId,
          planId: (await prisma.plan.upsert({ where: { key: 'basic' }, create: { key: 'basic', name: 'الباقة الأساسية' }, update: {} })).id,
          status: 'CANCELED',
        },
      })
      expect((await clientsList(testRequest('/api/clients', { user: admin }))).status).toBe(200)
    })
  })

  it('admin extend-trial restores write access and leaves an audit trail attributed to the target office', async () => {
    const manager = await officeWithSubscription('TRIALING', { trialEndsAt: new Date(Date.now() - DAY) })

    await asPlatformAdmin(async (admin) => {
      expect((await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'x' } }))).status).toBe(402)

      const res = await adminExtendTrial(
        testRequest(`/api/admin/offices/${manager.officeId}/extend-trial`, { method: 'POST', user: admin }),
        testParams({ officeId: manager.officeId }),
      )
      expect(res.status).toBe(200)
      expect((await readJson(res)).status.status).toBe('TRIALING')

      const writeRes = await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'Now Allowed' } }))
      expect(writeRes.status).toBe(201)

      const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.trial_extended', entityId: manager.officeId } })
      expect(audit).not.toBeNull()
      expect(audit?.actorEmail).toBe(admin.email)
      expect(audit?.officeId).toBe(manager.officeId)
    })
  })

  it('admin suspend blocks a healthy ACTIVE office immediately (non-auth endpoints 402) and is audited', async () => {
    const manager = await officeWithSubscription('ACTIVE', { currentPeriodEnd: new Date(Date.now() + 30 * DAY) })

    await asPlatformAdmin(async (admin) => {
      expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(200)

      const res = await adminSuspend(
        testRequest(`/api/admin/offices/${manager.officeId}/suspend`, { method: 'POST', user: admin }),
        testParams({ officeId: manager.officeId }),
      )
      expect(res.status).toBe(200)

      expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(402)
      expect((await clientsCreate(testRequest('/api/clients', { method: 'POST', user: manager, body: { name: 'x' } }))).status).toBe(402)

      const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.office_suspended', entityId: manager.officeId } })
      expect(audit).not.toBeNull()
    })
  })

  it('admin activate restores a suspended office and is audited', async () => {
    const manager = await officeWithSubscription('CANCELED')

    await asPlatformAdmin(async (admin) => {
      expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(402)

      const res = await adminActivate(
        testRequest(`/api/admin/offices/${manager.officeId}/activate`, { method: 'POST', user: admin }),
        testParams({ officeId: manager.officeId }),
      )
      expect(res.status).toBe(200)
      expect((await readJson(res)).status.status).toBe('ACTIVE')

      expect((await clientsList(testRequest('/api/clients', { user: manager }))).status).toBe(200)

      const audit = await prisma.auditLog.findFirst({ where: { action: 'admin.office_activated', entityId: manager.officeId } })
      expect(audit).not.toBeNull()
    })
  })

  it('a non-platform-admin manager cannot call the admin office-action routes (403), and a missing office 404s', async () => {
    const target = await officeWithSubscription('TRIALING', { trialEndsAt: new Date(Date.now() - DAY) })
    const outsider = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
    createdOffices.push(outsider.officeId)

    const forbidden = await adminActivate(
      testRequest(`/api/admin/offices/${target.officeId}/activate`, { method: 'POST', user: outsider }),
      testParams({ officeId: target.officeId }),
    )
    expect(forbidden.status).toBe(403)

    await asPlatformAdmin(async (admin) => {
      const missing = await adminActivate(
        testRequest('/api/admin/offices/does-not-exist/activate', { method: 'POST', user: admin }),
        testParams({ officeId: 'does-not-exist' }),
      )
      expect(missing.status).toBe(404)
    })
  })
})
