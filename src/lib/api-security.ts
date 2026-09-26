import { isIP } from 'net'
import { NextRequest, NextResponse } from 'next/server'

// Rate limiting here is in-process memory (a Map on globalThis) — correct
// and sufficient for a single Node process, but it does NOT coordinate
// across multiple instances. If this app is ever run as more than one
// process/container behind a load balancer (horizontal scaling, or even
// Hostinger restarting/replacing the process), each instance enforces its
// own limits independently: a client bounced between two instances
// effectively gets `limit * instanceCount` requests through, and every
// restart silently resets everyone's counters to zero. That's a real gap,
// not a hypothetical one — it is NOT solved by the cleanup/cap work below,
// which only bounds the memory of a *single* process's store.
//
// If/when this app runs as more than one instance, replace this with a
// shared store (Redis is the standard choice — e.g. `INCR` + `EXPIRE` per
// key) so all instances see the same counters. Do not attempt to patch
// around it with sticky sessions or client-IP-based routing — those don't
// hold up behind most load balancers and don't fix the restart-resets-
// everyone problem. This module's public API (rateLimit, rejectCrossSite,
// enforceRequestSecurity) is already the seam every route calls through —
// a Redis-backed rewrite of rateLimit()'s internals would not require
// touching any of the ~15 routes that call it.

type RateLimitOptions = {
  limit: number
  windowMs: number
}

type RateLimitEntry = {
  count: number
  resetAt: number
}

// Hard cap on the store's size, enforced by cleanup() below as a backstop
// in case a burst of unique keys arrives faster than their natural expiry
// (e.g. a distributed scan hitting many buckets at once) — without this,
// that scenario would grow the Map without bound between cleanup runs.
const MAX_ENTRIES = 50_000
const CLEANUP_INTERVAL_MS = 5 * 60_000

const globalForSecurity = globalThis as unknown as {
  dostooriRateLimit?: Map<string, RateLimitEntry>
  dostooriRateLimitCleanupStarted?: boolean
}

const rateLimitStore = globalForSecurity.dostooriRateLimit ?? new Map<string, RateLimitEntry>()
globalForSecurity.dostooriRateLimit = rateLimitStore

/** Test-only accessor — verifies cleanup actually shrinks the store. */
export function __getRateLimitStoreSizeForTests() {
  return rateLimitStore.size
}

/**
 * Drops expired entries so the store doesn't grow forever — previously
 * nothing ever removed a key once its window passed, only overwrote it if
 * the *same* key was hit again. A one-off visitor's entry would otherwise
 * sit in memory for the lifetime of the process.
 */
export function cleanupRateLimitStore(now = Date.now()) {
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt <= now) rateLimitStore.delete(key)
  }
  if (rateLimitStore.size > MAX_ENTRIES) {
    const excess = rateLimitStore.size - MAX_ENTRIES
    const it = rateLimitStore.keys()
    for (let i = 0; i < excess; i++) {
      const next = it.next()
      if (next.done) break
      rateLimitStore.delete(next.value)
    }
  }
}

// Guarded by a flag on globalThis (not just a module-level check) because
// Next.js dev-mode hot-reload re-executes this module's top level on every
// edit — without the guard, each reload would stack another interval.
if (!globalForSecurity.dostooriRateLimitCleanupStarted) {
  globalForSecurity.dostooriRateLimitCleanupStarted = true
  const timer = setInterval(() => cleanupRateLimitStore(), CLEANUP_INTERVAL_MS)
  timer.unref?.()
}

/**
 * Whether proxy-supplied client-IP headers may be believed. Only true when
 * the app sits behind our own reverse proxy (deploy/setup-nginx.sh sets
 * X-Real-IP to the TCP peer and appends it to X-Forwarded-For, overwriting or
 * extending anything the client sent) — docker-compose.yml sets
 * TRUST_PROXY=1 for exactly that topology. Without a trusted proxy those
 * headers are pure client input: honoring them let anyone rotate a fake
 * X-Forwarded-For per request and never hit a rate limit.
 */
function trustProxy(): boolean {
  const v = process.env.TRUST_PROXY?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

/**
 * Best-effort client IP for rate limiting and audit logs — not an
 * authentication or authorization signal. Behind the trusted proxy: the
 * proxy's X-Real-IP, else the LAST X-Forwarded-For entry (the hop our proxy
 * appended; earlier entries are client-supplied). Anything that doesn't
 * parse as an IP address is ignored. Without a trusted proxy every request
 * resolves to one shared 'direct' bucket — correct for local development,
 * and fail-safe (limits still apply) if TRUST_PROXY is ever missing in
 * production.
 */
export function getClientIp(req: NextRequest): string {
  if (!trustProxy()) return 'direct'
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp && isIP(realIp)) return realIp
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && isIP(last)) return last
  }
  return 'unknown'
}

// Whether the client's connection to us is HTTPS. Reads the actual request
// (and the reverse-proxy header a TLS-terminating proxy sets) rather than
// NODE_ENV, so it stays correct no matter how NODE_ENV is set in the
// deployment environment. Used to decide the cookie `Secure` flag — relying
// on NODE_ENV there risked issuing session cookies without `Secure` in a
// production deployment that never quite got NODE_ENV=production wired up.
export function isHttpsRequest(req: NextRequest) {
  const forwardedProto = req.headers.get('x-forwarded-proto')
  if (forwardedProto) return forwardedProto.split(',')[0].trim().toLowerCase() === 'https'
  return req.nextUrl.protocol === 'https:'
}

function expectedOrigins(req: NextRequest) {
  const host = req.headers.get('host')
  const proto = isHttpsRequest(req) ? 'https' : 'http'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  return [host ? `${proto}://${host}` : '', appUrl || ''].filter(Boolean)
}

export function rejectCrossSite(req: NextRequest) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return null

  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site') {
    return NextResponse.json({ error: 'طلب غير موثوق' }, { status: 403 })
  }

  const origin = req.headers.get('origin')
  if (!origin) return null

  if (!expectedOrigins(req).includes(origin)) {
    return NextResponse.json({ error: 'مصدر الطلب غير مسموح' }, { status: 403 })
  }

  return null
}

export function rateLimit(req: NextRequest, bucket: string, options: RateLimitOptions) {
  const now = Date.now()
  const key = `${bucket}:${getClientIp(req)}`
  const existing = rateLimitStore.get(key)

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs })
    return null
  }

  existing.count += 1
  if (existing.count <= options.limit) return null

  const retryAfter = Math.ceil((existing.resetAt - now) / 1000)
  return NextResponse.json(
    { error: 'محاولات كثيرة، جرّب لاحقاً' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

export function enforceRequestSecurity(req: NextRequest, bucket: string, options: RateLimitOptions) {
  return rejectCrossSite(req) ?? rateLimit(req, bucket, options)
}

// ── Per-account failure throttling ─────────────────────────────────────────
// IP-keyed limits alone don't protect one account from a distributed guess
// (many IPs, few attempts each). These count *failures* per account key
// (e.g. the login email) regardless of IP: after `limit` failures within the
// window, further attempts are refused until it expires. A success clears
// the counter. Same single-process store as rateLimit() above.

const FAILURE_PREFIX = 'failures:'

/** 429 if this account key already has `limit` recent failures; does not count this attempt. */
export function accountThrottle(key: string, limit: number): NextResponse | null {
  const entry = rateLimitStore.get(FAILURE_PREFIX + key)
  const now = Date.now()
  if (!entry || entry.resetAt <= now || entry.count < limit) return null
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
  return NextResponse.json(
    { error: 'محاولات فاشلة كثيرة لهذا الحساب، جرّب لاحقاً', code: 'account_throttled' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

export function recordAccountFailure(key: string, windowMs: number) {
  const now = Date.now()
  const storeKey = FAILURE_PREFIX + key
  const entry = rateLimitStore.get(storeKey)
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(storeKey, { count: 1, resetAt: now + windowMs })
  } else {
    entry.count += 1
  }
}

export function clearAccountFailures(key: string) {
  rateLimitStore.delete(FAILURE_PREFIX + key)
}
