import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { __getRateLimitStoreSizeForTests, accountThrottle, cleanupRateLimitStore, clearAccountFailures, getClientIp, isHttpsRequest, rateLimit, recordAccountFailure } from './api-security'

function fakeRequest(opts: { ip?: string; headers?: Record<string, string>; url?: string } = {}) {
  const headers = { 'x-forwarded-for': opts.ip ?? '203.0.113.5', ...opts.headers }
  return new NextRequest(opts.url ?? 'https://dostoori.jo/api/test', { headers })
}

describe('rateLimit', () => {
  it('allows requests up to the limit, then blocks with 429 + Retry-After', () => {
    const bucket = `test:${Math.random()}`
    const req = fakeRequest()
    const options = { limit: 3, windowMs: 60_000 }

    expect(rateLimit(req, bucket, options)).toBeNull()
    expect(rateLimit(req, bucket, options)).toBeNull()
    expect(rateLimit(req, bucket, options)).toBeNull()

    const blocked = rateLimit(req, bucket, options)
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBeTruthy()
  })

  it('tracks limits per client IP independently', () => {
    const bucket = `test:${Math.random()}`
    const options = { limit: 1, windowMs: 60_000 }
    const reqA = fakeRequest({ ip: '203.0.113.10' })
    const reqB = fakeRequest({ ip: '203.0.113.20' })

    expect(rateLimit(reqA, bucket, options)).toBeNull()
    expect(rateLimit(reqA, bucket, options)).not.toBeNull() // A is now over limit
    expect(rateLimit(reqB, bucket, options)).toBeNull() // B is unaffected
  })

  it('tracks limits per bucket independently for the same IP', () => {
    const options = { limit: 1, windowMs: 60_000 }
    const req = fakeRequest({ ip: '203.0.113.30' })

    expect(rateLimit(req, `bucket-a:${Math.random()}`, options)).toBeNull()
    const bucketB = `bucket-b:${Math.random()}`
    expect(rateLimit(req, bucketB, options)).toBeNull()
    expect(rateLimit(req, bucketB, options)).not.toBeNull()
  })
})

describe('rateLimit — client IP resolution from X-Forwarded-For', () => {
  it('uses the LAST entry in the chain, not the first (client-spoofable) one', () => {
    const bucket = `test:${Math.random()}`
    const options = { limit: 1, windowMs: 60_000 }
    // Same real (last) IP, different attacker-controlled first entry —
    // must be treated as the SAME client.
    const reqA = fakeRequest({ ip: '9.9.9.9, 203.0.113.50' })
    const reqB = fakeRequest({ ip: '8.8.8.8, 203.0.113.50' })

    expect(rateLimit(reqA, bucket, options)).toBeNull()
    expect(rateLimit(reqB, bucket, options)).not.toBeNull() // same real client, already at limit
  })

  it('treats different LAST entries as different clients even with an identical spoofed first entry', () => {
    const bucket = `test:${Math.random()}`
    const options = { limit: 1, windowMs: 60_000 }
    const reqA = fakeRequest({ ip: '1.1.1.1, 203.0.113.60' })
    const reqB = fakeRequest({ ip: '1.1.1.1, 203.0.113.61' })

    expect(rateLimit(reqA, bucket, options)).toBeNull()
    expect(rateLimit(reqB, bucket, options)).toBeNull() // genuinely different client, not yet limited
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const bucket = `test:${Math.random()}`
    const options = { limit: 1, windowMs: 60_000 }
    const req = new NextRequest('https://dostoori.jo/api/test', { headers: { 'x-real-ip': '203.0.113.70' } })
    const req2 = new NextRequest('https://dostoori.jo/api/test', { headers: { 'x-real-ip': '203.0.113.70' } })

    expect(rateLimit(req, bucket, options)).toBeNull()
    expect(rateLimit(req2, bucket, options)).not.toBeNull()
  })
})

describe('cleanupRateLimitStore', () => {
  it('removes an entry once its window has passed', () => {
    const bucket = `cleanup-test:${Math.random()}`
    const req = fakeRequest({ ip: '203.0.113.90' })
    rateLimit(req, bucket, { limit: 5, windowMs: 1000 })

    const sizeBefore = __getRateLimitStoreSizeForTests()
    cleanupRateLimitStore(Date.now() + 2000) // simulate "2 seconds later" without a real sleep
    const sizeAfter = __getRateLimitStoreSizeForTests()

    expect(sizeAfter).toBeLessThan(sizeBefore)
  })

  it('does not remove an entry whose window has not passed yet', () => {
    const bucket = `cleanup-test:${Math.random()}`
    const req = fakeRequest({ ip: '203.0.113.91' })
    rateLimit(req, bucket, { limit: 1, windowMs: 60_000 })

    cleanupRateLimitStore(Date.now()) // "now" — the entry is still valid
    // The entry should survive, so a second request against the same
    // bucket/IP should still be correctly blocked (limit was 1).
    const blocked = rateLimit(req, bucket, { limit: 1, windowMs: 60_000 })
    expect(blocked).not.toBeNull()
  })

  it('enforces a hard cap on store size as a backstop against unbounded growth', () => {
    const prefix = `cap-test-${Math.random()}`
    for (let i = 0; i < 50_001; i++) {
      rateLimit(fakeRequest({ ip: `10.0.${Math.floor(i / 256)}.${i % 256}` }), `${prefix}:${i}`, { limit: 1, windowMs: 60_000 })
    }
    cleanupRateLimitStore(Date.now()) // nothing has expired — only the cap should trim it
    expect(__getRateLimitStoreSizeForTests()).toBeLessThanOrEqual(50_000)
  })
})

describe('isHttpsRequest', () => {
  it('trusts x-forwarded-proto: https from a TLS-terminating proxy', () => {
    const req = fakeRequest({ url: 'http://dostoori.jo/api/test', headers: { 'x-forwarded-proto': 'https' } })
    expect(isHttpsRequest(req)).toBe(true)
  })

  it('trusts x-forwarded-proto: http even if the inner request looks https', () => {
    const req = fakeRequest({ url: 'https://dostoori.jo/api/test', headers: { 'x-forwarded-proto': 'http' } })
    expect(isHttpsRequest(req)).toBe(false)
  })

  it('takes the first value from a comma-separated x-forwarded-proto chain', () => {
    const req = fakeRequest({ url: 'http://dostoori.jo/api/test', headers: { 'x-forwarded-proto': 'https, http' } })
    expect(isHttpsRequest(req)).toBe(true)
  })

  it('falls back to the request protocol when no proxy header is present', () => {
    expect(isHttpsRequest(fakeRequest({ url: 'https://dostoori.jo/api/test' }))).toBe(true)
    expect(isHttpsRequest(fakeRequest({ url: 'http://dostoori.jo/api/test' }))).toBe(false)
  })

  it('never relies on NODE_ENV', () => {
    const originalEnv = process.env.NODE_ENV
    try {
      // @ts-expect-error test-only override of a normally readonly-typed var
      process.env.NODE_ENV = 'development'
      expect(isHttpsRequest(fakeRequest({ url: 'https://dostoori.jo/api/test' }))).toBe(true)
      // @ts-expect-error test-only override
      process.env.NODE_ENV = undefined
      expect(isHttpsRequest(fakeRequest({ url: 'https://dostoori.jo/api/test' }))).toBe(true)
    } finally {
      // @ts-expect-error restore
      process.env.NODE_ENV = originalEnv
    }
  })
})

describe('getClientIp — proxy headers trusted only behind our own proxy', () => {
  const withTrust = async (value: string | undefined, fn: () => void | Promise<void>) => {
    const original = process.env.TRUST_PROXY
    if (value === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = value
    try { await fn() } finally {
      if (original === undefined) delete process.env.TRUST_PROXY
      else process.env.TRUST_PROXY = original
    }
  }

  it('without TRUST_PROXY, client-supplied headers are ignored (no per-request rotation to dodge limits)', async () => {
    await withTrust(undefined, () => {
      expect(getClientIp(fakeRequest({ ip: '1.1.1.1' }))).toBe('direct')
      expect(getClientIp(fakeRequest({ ip: '2.2.2.2', headers: { 'x-real-ip': '3.3.3.3' } }))).toBe('direct')
    })
  })

  it('behind the proxy, prefers X-Real-IP (set by nginx, overwriting any client value)', async () => {
    await withTrust('1', () => {
      expect(getClientIp(fakeRequest({ ip: '9.9.9.9, 203.0.113.7', headers: { 'x-real-ip': '198.51.100.4' } }))).toBe('198.51.100.4')
    })
  })

  it('ignores values that are not IP addresses', async () => {
    await withTrust('1', () => {
      expect(getClientIp(fakeRequest({ ip: 'not-an-ip', headers: { 'x-real-ip': '<script>' } }))).toBe('unknown')
      expect(getClientIp(fakeRequest({ ip: '1.1.1.1, garbage' }))).toBe('unknown')
    })
  })
})

describe('accountThrottle — per-account failures, independent of IP', () => {
  it('blocks after the limit, and a success clears it', () => {
    const key = `unit-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(accountThrottle(key, 3)).toBeNull()
      recordAccountFailure(key, 60_000)
    }
    expect(accountThrottle(key, 3)?.status).toBe(429)
    clearAccountFailures(key)
    expect(accountThrottle(key, 3)).toBeNull()
  })
})
