import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/nextjs'
import { scrubEvent, scrubString, scrubValue } from './sentry-scrub'

describe('scrubString', () => {
  it('redacts email addresses', () => {
    expect(scrubString('login failed for hussein.almaestroo@gmail.com'))
      .toBe('login failed for [redacted-email]')
  })

  it('redacts JWTs and ds_token cookies', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abc-DEF_123'
    expect(scrubString(`token ${jwt}`)).toBe('token [redacted-token]')
    expect(scrubString('Cookie: ds_token=eyJx.eYy.zZz; other=1'))
      .toContain('ds_token=[redacted-token]')
  })

  it('redacts bearer tokens and long hex blobs (service keys)', () => {
    expect(scrubString('authorization: Bearer sk_live_abcdefgh')).toContain('[redacted-token]')
    expect(scrubString('key=09ec428ce8b9bc6366d42becc610aebd2221465c5e1167c70048e8127fd478a5'))
      .toBe('key=[redacted-hex]')
  })

  it('truncates very long strings so a document body cannot leak in full', () => {
    const long = 'x'.repeat(5000)
    const out = scrubString(long)
    expect(out.length).toBeLessThan(2100)
    expect(out).toContain('[+3000 chars]')
  })
})

describe('scrubValue', () => {
  it('walks nested objects and arrays', () => {
    const out = scrubValue({ a: ['contact me@x.co', { b: 'me@x.co' }] }) as { a: [string, { b: string }] }
    expect(out.a[0]).toBe('contact [redacted-email]')
    expect(out.a[1].b).toBe('[redacted-email]')
  })

  it('bottoms out instead of recursing forever on a cycle', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => scrubValue(cyclic)).not.toThrow()
  })
})

describe('scrubEvent (Sentry beforeSend)', () => {
  it('drops request body / cookies / auth headers and the user block, keeps method + bare path', () => {
    const event = {
      request: {
        method: 'POST',
        url: 'https://app.example.com/api/ai/contract-review?reset=secrettoken',
        query_string: 'reset=secrettoken',
        data: { contractText: 'CONFIDENTIAL full contract body …' },
        cookies: { ds_token: 'eyJx.eYy.zZz' },
        headers: { cookie: 'ds_token=eyJx.eYy.zZz', authorization: 'Bearer abc', 'x-internal-service-key': 'deadbeef', 'user-agent': 'test' },
      },
      user: { email: 'client@example.com', id: 'u_1' },
      exception: { values: [{ type: 'Error', value: 'failed for client@example.com with ds_token=eyJx.eYy.zZz' }] },
      breadcrumbs: [{ message: 'POST /api/x by admin@dostoori.jo' }],
      extra: { note: 'salt 09ec428ce8b9bc6366d42becc610aebd2221465c5e1167c70048e8127fd478a5' },
    } as unknown as ErrorEvent

    const out = scrubEvent(event)!

    expect(out.request?.data).toBeUndefined()
    expect(out.request?.cookies).toBeUndefined()
    expect(out.request?.headers).not.toHaveProperty('cookie')
    expect(out.request?.headers).not.toHaveProperty('authorization')
    expect(out.request?.headers).not.toHaveProperty('x-internal-service-key')
    expect(out.request?.headers).toHaveProperty('user-agent') // non-sensitive header kept
    expect(out.request?.method).toBe('POST')
    expect(out.request?.url).toBe('https://app.example.com/api/ai/contract-review')
    expect(out.request?.query_string).toBe('')
    expect(out.user).toBeUndefined()

    const value = out.exception!.values![0].value!
    expect(value).not.toContain('client@example.com')
    expect(value).not.toContain('eyJx.eYy.zZz')
    expect(value).toContain('[redacted-email]')

    expect(out.breadcrumbs![0].message).toBe('POST /api/x by [redacted-email]')
    expect(JSON.stringify(out.extra)).not.toContain('09ec428ce8b9bc6366')

    // whole serialized event carries none of the secrets
    const dump = JSON.stringify(out)
    for (const secret of ['CONFIDENTIAL full contract', 'client@example.com', 'eyJx.eYy.zZz', 'deadbeef', 'secrettoken']) {
      expect(dump).not.toContain(secret)
    }
  })
})
