import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { verifyStripeWebhookSignature } from './billing'

// Builds a signature header exactly the way Stripe's own SDKs do, so this
// test proves verifyStripeWebhookSignature() implements the real documented
// scheme (HMAC-SHA256 of "${timestamp}.${body}") — not just "looks
// plausible." See https://docs.stripe.com/webhooks#verify-manually
function signLikeStripe(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

describe('verifyStripeWebhookSignature', () => {
  const secret = 'whsec_test_secret_1234567890'
  const body = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.updated' })

  it('accepts a correctly-signed payload', () => {
    const header = signLikeStripe(body, secret)
    expect(verifyStripeWebhookSignature(body, header, secret)).toBe(true)
  })

  it('rejects a payload that was tampered with after signing', () => {
    const header = signLikeStripe(body, secret)
    const tamperedBody = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.deleted' })
    expect(verifyStripeWebhookSignature(tamperedBody, header, secret)).toBe(false)
  })

  it('rejects a signature produced with the wrong secret', () => {
    const header = signLikeStripe(body, 'whsec_wrong_secret')
    expect(verifyStripeWebhookSignature(body, header, secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyStripeWebhookSignature(body, null, secret)).toBe(false)
  })

  it('rejects a malformed signature header', () => {
    expect(verifyStripeWebhookSignature(body, 'not-a-real-header', secret)).toBe(false)
    expect(verifyStripeWebhookSignature(body, 't=123', secret)).toBe(false)
  })

  it('rejects a stale signature (replay protection)', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600 // 1 hour old
    const header = signLikeStripe(body, secret, oldTimestamp)
    expect(verifyStripeWebhookSignature(body, header, secret)).toBe(false)
  })
})
