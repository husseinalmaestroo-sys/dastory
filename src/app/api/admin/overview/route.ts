import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth-server'
import { withErrorHandling } from '@/lib/api-handler'

// The admin panel's data feed. Everything on /admin that used to be a
// hardcoded example row or a fixed digit (subscriber list, stat tiles,
// "newest offices") now reads from here. Platform-admin only — the same
// gate as its neighbour GET /api/trial-requests.
//
// Deliberately NOT here: monthly revenue / MRR. No plan in PLAN_SEED_DATA
// carries a price and nothing takes a payment yet (see billing.ts), so any
// currency figure would be invented — exactly what this route exists to
// remove. Wire it in with Stripe (launch plan item 05).

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) return auth.response

  const [statusGroups, totalOffices, newTrialRequests, offices] = await Promise.all([
    prisma.subscription.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.office.count(),
    prisma.trialRequest.count({ where: { status: 'NEW' } }),
    prisma.office.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        active: true,
        createdAt: true,
        // The office's manager is the "responsible lawyer" column. An office
        // always has at least one OFFICE_MANAGER (its signup user); take the
        // earliest as the canonical one.
        users: {
          where: { role: 'OFFICE_MANAGER' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { name: true, email: true },
        },
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            plan: { select: { name: true } },
          },
        },
      },
    }),
  ])

  const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count.status]))
  const active = byStatus.ACTIVE ?? 0
  const trialing = byStatus.TRIALING ?? 0
  const pastDue = byStatus.PAST_DUE ?? 0
  const canceled = byStatus.CANCELED ?? 0

  const stats = {
    subscribedOffices: active + trialing, // "paying or in trial"
    activeOffices: active,
    trialingOffices: trialing,
    pastDueOffices: pastDue,
    canceledOffices: canceled,
    totalOffices,
    newTrialRequests,
  }

  const subscribers = offices.map((office) => ({
    officeId: office.id,
    officeName: office.name,
    officeActive: office.active,
    managerName: office.users[0]?.name ?? null,
    managerEmail: office.users[0]?.email ?? null,
    plan: office.subscription?.plan.name ?? null,
    status: office.subscription?.status ?? 'NONE',
    renewsAt: office.subscription?.currentPeriodEnd ?? office.subscription?.trialEndsAt ?? null,
    createdAt: office.createdAt,
  }))

  return NextResponse.json({ stats, subscribers })
})
