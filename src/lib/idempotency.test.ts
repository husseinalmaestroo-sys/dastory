import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { withIdempotency } from './idempotency'

// The no-key path never touches Prisma, so it's covered here as a pure
// unit test. The claim/replay/race behavior needs a real database and is
// covered by the integration suite (src/lib/idempotency.integration.test.ts)
// plus live verification against the running app — see the Phase 2 report.

function req(headers: Record<string, string> = {}) {
  return new NextRequest('https://dostoori.jo/api/test', { method: 'POST', headers })
}

describe('withIdempotency — no key provided', () => {
  it('runs the handler directly and returns its result, unmodified', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { id: 'created-1' } })
    const res = await withIdempotency(req(), 'user-1', 'test:create', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'created-1' })
  })

  it('treats an empty Idempotency-Key header the same as no header', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } })
    const res = await withIdempotency(req({ 'idempotency-key': '' }), 'user-1', 'test:create', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('treats a whitespace-only Idempotency-Key header the same as no header', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } })
    const res = await withIdempotency(req({ 'idempotency-key': '   ' }), 'user-1', 'test:create', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('treats an overlong key (>200 chars) as if none was provided, running the handler directly', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } })
    const res = await withIdempotency(req({ 'idempotency-key': 'x'.repeat(201) }), 'user-1', 'test:create', handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
  })

  it('propagates the handler status code exactly for error responses too', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 400, body: { error: 'bad input' } })
    const res = await withIdempotency(req(), 'user-1', 'test:create', handler)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad input' })
  })
})
