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
