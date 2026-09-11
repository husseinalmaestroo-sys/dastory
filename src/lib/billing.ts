import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'

/**
 * Billing architecture — NOT connected to Stripe or any payment provider.
 * No STRIPE_SECRET_KEY is read anywhere in this codebase and nothing here
 * can charge a card. What IS real: the Plan/Subscription data model, a
 * genuine trial-period concept applied on signup, and a correct
 * implementation of Stripe's webhook signature scheme (verifiable against
 * Stripe's own documented test vectors — see billing.test.ts) ready for the
 * day real keys are added. See ARCHITECTURE.md "Known gaps."
 */

export const PLAN_SEED_DATA = [
  { key: 'basic', name: 'الباقة الأساسية', maxUsers: 5, maxCases: 200, aiCallsPerMonth: 100 },
  { key: 'automation', name: 'باقة الأتمتة', maxUsers: 15, maxCases: 1000, aiCallsPerMonth: 500 },
  { key: 'web', name: 'باقة الموقع والدومين', maxUsers: null, maxCases: null, aiCallsPerMonth: 1000 },
] as const

const TRIAL_DAYS = 14

/** Idempotent — safe to call on every signup; does nothing if plans already exist. */
export async function ensurePlansSeeded(): Promise<void> {
  for (const plan of PLAN_SEED_DATA) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      create: plan,
      update: {},
    })
  }
}

/**
 * Starts a real (if payment-free) trial for a newly-created office on the
 * entry-level plan. Best-effort: a failure here must never block signup —
 * an office with no Subscription row is just treated as having no active
 * plan by getOfficeBillingStatus, not a broken account.
 */
export async function startTrialSubscription(officeId: string): Promise<void> {
  try {
    await ensurePlansSeeded()
    const basicPlan = await prisma.plan.findUnique({ where: { key: 'basic' } })
    if (!basicPlan) return
    await prisma.subscription.create({
      data: {
        officeId,
        planId: basicPlan.id,
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60_000),
      },
    })
  } catch (err) {
    console.error('[billing] failed to start trial subscription', err)
  }
}

export interface BillingStatus {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'NONE'
  planName: string | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  daysLeftInTrial: number | null
}

export async function getOfficeBillingStatus(officeId: string): Promise<BillingStatus> {
  const subscription = await prisma.subscription.findUnique({
    where: { officeId },
    include: { plan: true },
  })
  if (!subscription) {
    return { status: 'NONE', planName: null, trialEndsAt: null, currentPeriodEnd: null, daysLeftInTrial: null }
  }
  const daysLeftInTrial = subscription.status === 'TRIALING' && subscription.trialEndsAt
    ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60_000)))
    : null
  return {
    status: subscription.status,
    planName: subscription.plan.name,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodEnd: subscription.currentPeriodEnd,
    daysLeftInTrial,
  }
}

// ── Enforcement ──────────────────────────────────────────────────────────
// The consequence side of billing status: three tiers, escalating.
//   active  — nothing restricted.
//   grace   — trial/period just lapsed: reads still work, writes 402. Gives
//             an office a window to notice and pay before losing access to
//             its own data, not just before losing the ability to add more.
//   blocked — grace window used up, or CANCELED/suspended outright: every
//             non-auth request 402s (see requireOfficeUser in auth-server.ts,
//             which calls getSubscriptionEnforcement and is what every
//             office-scoped route already runs through).
// No Subscription row at all is treated as 'active' — enforcement must
// never punish a state it can't explain to an office, and every real
// signup gets a TRIALING row via startTrialSubscription above; a missing
// row only happens for hand-seeded or legacy data.
export const GRACE_PERIOD_DAYS = 7

export type SubscriptionTier = 'active' | 'grace' | 'blocked'

export interface SubscriptionEnforcement {
  tier: SubscriptionTier
  /** End of the current grace window — set for 'grace', and for 'blocked' reached by a grace window running out. Null for 'active' and for an outright CANCELED/suspended office, which never had a grace window. */
  graceEndsAt: Date | null
}

function graceOrBlocked(anchor: Date): SubscriptionEnforcement {
  const graceEndsAt = new Date(anchor.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60_000)
  return { tier: Date.now() <= graceEndsAt.getTime() ? 'grace' : 'blocked', graceEndsAt }
}

export async function getSubscriptionEnforcement(officeId: string): Promise<SubscriptionEnforcement> {
  const subscription = await prisma.subscription.findUnique({ where: { officeId } })
  if (!subscription) return { tier: 'active', graceEndsAt: null }

  switch (subscription.status) {
    case 'ACTIVE':
      return { tier: 'active', graceEndsAt: null }
    case 'CANCELED':
      // An admin "suspend" is recorded as CANCELED too (adminSuspendSubscription
      // below) — no grace either way: it's a stop, not a lapse.
      return { tier: 'blocked', graceEndsAt: null }
    case 'TRIALING':
      if (!subscription.trialEndsAt || subscription.trialEndsAt.getTime() > Date.now()) {
        return { tier: 'active', graceEndsAt: null }
      }
      return graceOrBlocked(subscription.trialEndsAt)
    case 'PAST_DUE':
      return graceOrBlocked(subscription.currentPeriodEnd ?? subscription.updatedAt)
    default:
      return { tier: 'active', graceEndsAt: null }
  }
}

async function resolvePlanId(officeId: string): Promise<string> {
  const existing = await prisma.subscription.findUnique({ where: { officeId }, select: { planId: true } })
  if (existing) return existing.planId
  await ensurePlansSeeded()
  const basicPlan = await prisma.plan.findUniqueOrThrow({ where: { key: 'basic' } })
  return basicPlan.id
}

const ACTIVE_PERIOD_DAYS = 30

/** Admin action: grants (or restores) a full paid period and clears any suspension. */
export async function adminActivateSubscription(officeId: string): Promise<void> {
  const planId = await resolvePlanId(officeId)
  const currentPeriodEnd = new Date(Date.now() + ACTIVE_PERIOD_DAYS * 24 * 60 * 60_000)
  await prisma.subscription.upsert({
    where: { officeId },
    create: { officeId, planId, status: 'ACTIVE', currentPeriodEnd },
    update: { status: 'ACTIVE', currentPeriodEnd, canceledAt: null },
  })
}

/** Admin action: the "CANCELED/suspended -> full 402 wall" state — the same status a real Stripe cancellation webhook would set (see the header comment above), just set by hand instead. */
export async function adminSuspendSubscription(officeId: string): Promise<void> {
  const planId = await resolvePlanId(officeId)
  await prisma.subscription.upsert({
    where: { officeId },
    create: { officeId, planId, status: 'CANCELED', canceledAt: new Date() },
    update: { status: 'CANCELED', canceledAt: new Date() },
  })
}

/** Admin action: a fresh TRIAL_DAYS-day trial from now — the escape hatch for "the trial ran out but let them keep evaluating." */
export async function adminExtendTrialSubscription(officeId: string): Promise<void> {
  const planId = await resolvePlanId(officeId)
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60_000)
  await prisma.subscription.upsert({
    where: { officeId },
    create: { officeId, planId, status: 'TRIALING', trialEndsAt },
    update: { status: 'TRIALING', trialEndsAt, canceledAt: null },
  })
}

// ── Stripe webhook signature verification ───────────────────────────────
// Real implementation of Stripe's documented scheme (a Stripe-Signature
// header of the form "t=<timestamp>,v1=<hmac>", verified as
// HMAC-SHA256(`${timestamp}.${rawBody}`, webhookSecret)) — not a stub.
// Testable right now without any Stripe account: billing.test.ts
// constructs a signature the same way Stripe's own libraries do and
// confirms this function accepts it and rejects a tampered payload.

const MAX_SIGNATURE_AGE_MS = 5 * 60_000

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [k, v] = part.split('=')
      return [k, v]
    })
  )
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false

  const age = Date.now() - Number(timestamp) * 1000
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_MS || age < -MAX_SIGNATURE_AGE_MS) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const actualBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}
