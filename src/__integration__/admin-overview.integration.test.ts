// Launch plan item 07 — "the admin panel shows real numbers".
//
// Before: /admin rendered a fixed subscriber list (مكتب الشوبكي …), a fixed
// trial-requests list, and hardcoded stat digits (23 / 7 / 1,840 / 2).
// After: GET /api/admin/overview returns real subscription counts + the real
// office list, GET /api/trial-requests feeds the real leads table, and the
// component maps that state instead of literal arrays.
//
// Count assertions are deltas from a baseline snapshot taken before this
// file's fixtures are created — the integration DB is shared, so absolute
// equality on a global COUNT(*) would be fragile; the delta is exact and
// residue-proof. "+2 / +1 / +0" here IS the plan's "the tiles read 2 / 1 / 0".
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { GET as adminOverview } from '@/app/api/admin/overview/route'
import { GET as trialRequestsGet } from '@/app/api/trial-requests/route'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest, type TestUser } from './helpers'
import { prisma } from '@/lib/prisma'

const TAG = `admin-ovw-${Date.now()}`
const ORIGINAL_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS

let admin: TestUser
let adminOfficeId: string
let activeOfficeId: string
let trialingOfficeId: string
let trialRequestId: string
let basicPlanId: string
let baseline: { subscribed: number; trialing: number; pastDue: number }

async function subscriptionCounts() {
  const groups = await prisma.subscription.groupBy({ by: ['status'], _count: { status: true } })
  const by = Object.fromEntries(groups.map((g) => [g.status, g._count.status]))
  return {
    subscribed: (by.ACTIVE ?? 0) + (by.TRIALING ?? 0),
    trialing: by.TRIALING ?? 0,
    pastDue: by.PAST_DUE ?? 0,
  }
}

async function makeOfficeWithSubscription(name: string, status: 'ACTIVE' | 'TRIALING') {
  const office = await prisma.office.create({ data: { name } })
  await prisma.user.create({
    data: {
      email: `mgr-${office.id}@example.jo`,
      password: 'x', // nothing authenticates as this user; it only supplies managerName
      name: `Manager of ${name}`,
      role: Role.OFFICE_MANAGER,
      officeId: office.id,
      emailVerified: true,
    },
  })
  await prisma.subscription.create({
    data: {
      officeId: office.id,
      planId: basicPlanId,
      status,
      trialEndsAt: status === 'TRIALING' ? new Date(Date.now() + 7 * 864e5) : null,
      currentPeriodEnd: status === 'ACTIVE' ? new Date(Date.now() + 30 * 864e5) : null,
    },
  })
  return office.id
}

beforeAll(async () => {
  admin = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  adminOfficeId = admin.officeId
  process.env.PLATFORM_ADMIN_EMAILS = admin.email

  const plan = await prisma.plan.upsert({
    where: { key: 'basic' },
    create: { key: 'basic', name: 'الباقة الأساسية', maxUsers: 5, maxCases: 200, aiCallsPerMonth: 100 },
    update: {},
  })
  basicPlanId = plan.id

  baseline = await subscriptionCounts()

  activeOfficeId = await makeOfficeWithSubscription(`${TAG} Active Office`, 'ACTIVE')
  trialingOfficeId = await makeOfficeWithSubscription(`${TAG} Trialing Office`, 'TRIALING')

  const tr = await prisma.trialRequest.create({
    data: {
      officeName: `${TAG} Lead Office`,
      officeLicense: 'LIC-1',
      city: 'عمّان',
      officePhone: '062000000',
      lawyerName: `${TAG} Lead Lawyer`,
      lawyerBarNumber: 'BAR-1',
      email: `${TAG}@lead.jo`,
      mobile: '0790000000',
      nationalId: '9990000000',
      status: 'NEW',
    },
  })
  trialRequestId = tr.id
})

afterAll(async () => {
  await prisma.trialRequest.deleteMany({ where: { id: trialRequestId } })
  await Promise.all([activeOfficeId, trialingOfficeId, adminOfficeId].filter(Boolean).map(cleanupOffice))
  if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.PLATFORM_ADMIN_EMAILS
  else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
})

describe('admin overview — real numbers, not hardcoded example rows', () => {
  it('is platform-admin only (401 anon, 403 for a normal office manager)', async () => {
    expect((await adminOverview(testRequest('/api/admin/overview'))).status).toBe(401)

    const outsider = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
    try {
      const res = await adminOverview(testRequest('/api/admin/overview', { user: outsider }))
      expect(res.status).toBe(403)
    } finally {
      await cleanupOffice(outsider.officeId)
    }
  })

  it('stat tiles move by exactly +2 subscribed / +1 trialing / +0 past-due for one ACTIVE + one TRIALING office', async () => {
    const res = await adminOverview(testRequest('/api/admin/overview', { user: admin }))
    expect(res.status).toBe(200)
    const { stats } = await readJson(res)

    expect(stats.subscribedOffices - baseline.subscribed).toBe(2)
    expect(stats.trialingOffices - baseline.trialing).toBe(1)
    expect(stats.pastDueOffices - baseline.pastDue).toBe(0)
    // internal consistency: the "subscribed" tile is exactly ACTIVE + TRIALING
    expect(stats.subscribedOffices).toBe(stats.activeOffices + stats.trialingOffices)
    // the seeded lead is counted
    expect(stats.newTrialRequests).toBeGreaterThanOrEqual(1)
  })

  it('the subscriber list carries our two fixture offices with their real status and manager', async () => {
    const { subscribers } = await readJson(await adminOverview(testRequest('/api/admin/overview', { user: admin })))

    const activeRow = subscribers.find((s: { officeId: string }) => s.officeId === activeOfficeId)
    const trialRow = subscribers.find((s: { officeId: string }) => s.officeId === trialingOfficeId)

    expect(activeRow).toMatchObject({ status: 'ACTIVE', officeName: `${TAG} Active Office`, plan: 'الباقة الأساسية' })
    expect(activeRow.managerName).toBe(`Manager of ${TAG} Active Office`)
    expect(trialRow).toMatchObject({ status: 'TRIALING', officeName: `${TAG} Trialing Office` })
    expect(typeof trialRow.renewsAt).toBe('string') // trialEndsAt surfaced as the renewal date

    // no fabricated example firms in the payload
    const json = JSON.stringify(subscribers)
    for (const fake of ['الشوبكي', 'النابلسي', 'القرعان', 'الزيود']) expect(json).not.toContain(fake)
  })

  it('GET /api/trial-requests returns the seeded lead with its real fields (the table data source)', async () => {
    const res = await trialRequestsGet(testRequest('/api/trial-requests', { user: admin }))
    expect(res.status).toBe(200)
    const rows = await readJson(res)
    const mine = rows.find((r: { id: string }) => r.id === trialRequestId)
    expect(mine).toMatchObject({
      officeName: `${TAG} Lead Office`,
      lawyerName: `${TAG} Lead Lawyer`,
      mobile: '0790000000',
      city: 'عمّان',
      status: 'NEW',
    })
  })

  it('the /admin component renders fetched state — no hardcoded example rows remain', () => {
    const src = readFileSync(fileURLToPath(new URL('../app/admin/page.tsx', import.meta.url)), 'utf8')
    for (const fake of [
      'الشوبكي', 'النابلسي', 'القرعان', 'الزيود', 'أبو الهيجاء', 'الرواشدة', 'عبيدات',
      'Admin — Dostoori', 'آخر تحديث: اليوم',
    ]) {
      expect(src).not.toContain(fake)
    }
    // the two tables map real state, not literal arrays of objects
    expect(src).toContain('subscribers.filter')
    expect(src).toContain('trialRequests.map((row)')
    expect(src).toContain("fetch('/api/admin/overview')")
  })
})
