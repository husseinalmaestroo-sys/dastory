import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyStripeWebhookSignature } from '@/lib/billing'

/**
 * Stripe webhook receiver — architecture only, genuinely unreachable in
 * practice right now: with no STRIPE_WEBHOOK_SECRET configured this always
 * 503s, and no real Stripe account is configured to ever call it anyway.
 * What's real: signature verification (verifyStripeWebhookSignature, unit-
 * tested against Stripe's documented scheme) and the event-handling shape
 * below — untested beyond that unit test, since exercising it end-to-end
 * requires an actual Stripe test-mode account this environment doesn't
 * have. Do not point a real Stripe webhook at this until that gap is
 * closed and it's been verified against real Stripe test events.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Billing webhook not configured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!verifyStripeWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  try {
    const obj = event.data?.object ?? {}
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const stripeSubscriptionId = typeof obj.id === 'string' ? obj.id : null
        if (!stripeSubscriptionId) break
        // Real Stripe event fields (customer, status, current_period_end)
        // would map here — left unmapped since there is no live Stripe
        // integration to verify the exact field shapes against yet.
        break
      }
      case 'customer.subscription.deleted': {
        const stripeSubscriptionId = typeof obj.id === 'string' ? obj.id : null
        if (!stripeSubscriptionId) break
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId },
          data: { status: 'CANCELED', canceledAt: new Date() },
        })
        break
      }
      default:
        break
    }
  } catch (err) {
    console.error('[billing/webhook] failed to process event', err)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
