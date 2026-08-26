import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { isHttpsRequest, rateLimit } from './api-security'

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
