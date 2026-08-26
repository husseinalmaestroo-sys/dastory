import { NextRequest, NextResponse } from 'next/server'

type RateLimitOptions = {
  limit: number
  windowMs: number
}

type RateLimitEntry = {
  count: number
  resetAt: number
}

const globalForSecurity = globalThis as unknown as {
  dostooriRateLimit?: Map<string, RateLimitEntry>
}

const rateLimitStore = globalForSecurity.dostooriRateLimit ?? new Map<string, RateLimitEntry>()
globalForSecurity.dostooriRateLimit = rateLimitStore

function clientIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
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
  const key = `${bucket}:${clientIp(req)}`
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
