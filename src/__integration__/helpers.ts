// Shared setup for integration tests: real Prisma writes against the
// dostoori_test database (see vitest.integration.setup.mts), real signed
// JWTs, real route handlers invoked directly (no HTTP server needed —
// Next.js Route Handlers are just functions).
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'

const BASE_URL = 'https://dostoori-integration-test.local'
const BASE_HOST = 'dostoori-integration-test.local'

export type TestUser = {
  id: string
  email: string
  name: string
  role: Role
  officeId: string
  clientId: string | null
  sessionVersion: number
  cookie: string
}

type UserOpts = {
  role?: Role
  password?: string
  clientId?: string | null
  twoFactorEnabled?: boolean
  twoFactorSecret?: string | null
  /** Defaults to true — most tests aren't exercising the email-verification gate and shouldn't have to think about it. Pass false explicitly to test unverified-account behavior. */
  emailVerified?: boolean
}

function toTestUser(user: {
  id: string; email: string; name: string; role: Role; officeId: string
  clientId: string | null; sessionVersion: number
}, twoFactorEnabled: boolean): TestUser {
  const token = signToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    clientId: user.clientId,
    sessionVersion: user.sessionVersion,
    twoFactorVerified: !twoFactorEnabled,
  })
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    clientId: user.clientId,
    sessionVersion: user.sessionVersion,
    cookie: `ds_token=${token}`,
  }
}

/** Creates an office + one user in it, directly via Prisma (fast, exact control over role/state). */
export async function createTestOfficeUser(opts: UserOpts = {}): Promise<TestUser & { officeId: string }> {
  const suffix = randomUUID().slice(0, 8)
  const office = await prisma.office.create({
    data: { name: `Integration Test Office ${suffix}` },
  })
  const user = await createColleague(office.id, opts)
  return user
}

/** Adds another user to an *existing* office — for same-office, different-person scenarios (e.g. "a colleague cannot delete this"). */
export async function createColleague(officeId: string, opts: UserOpts = {}): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8)
  const password = opts.password ?? 'TestPassw0rd!23'
  const user = await prisma.user.create({
    data: {
      email: `itest-${suffix}@example.jo`,
      password: await bcrypt.hash(password, 4), // low cost factor — speed, not security, in tests
      name: `Integration Tester ${suffix}`,
      role: opts.role ?? Role.OFFICE_MANAGER,
      officeId,
      clientId: opts.clientId ?? null,
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
      twoFactorSecret: opts.twoFactorSecret ?? null,
      emailVerified: opts.emailVerified ?? true,
    },
  })
  return toTestUser(user, opts.twoFactorEnabled ?? false)
}

/**
 * Builds a NextRequest against a route, pre-authenticated as `user` (or
 * anonymous if omitted). Defaults to a fresh random IP per call — the
 * rate limiter buckets by client IP (see api-security.ts), and every
 * synthetic test request would otherwise fall back to the same literal
 * 'local' IP, sharing one rate-limit bucket across unrelated tests. Pass
 * `ip` explicitly when a test specifically wants repeated calls to share
 * a bucket (e.g. testing the rate limit itself).
 */
export function testRequest(
  path: string,
  opts: {
    method?: string
    user?: TestUser | null
    body?: unknown
    headers?: Record<string, string>
    ip?: string
  } = {}
): NextRequest {
  const headers: Record<string, string> = {
    Origin: BASE_URL,
    Host: BASE_HOST,
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': opts.ip ?? `test-client-${randomUUID()}`,
    ...opts.headers,
  }
  if (opts.user) headers.Cookie = opts.user.cookie
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  return new NextRequest(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

/**
 * Same as testRequest, but for multipart/form-data (file upload) bodies.
 * A plain `Request` won't do — route handlers call isHttpsRequest(req),
 * which reads req.nextUrl, a NextRequest-only property; a real NextRequest
 * is required even for the FormData-body case.
 */
export function testFormRequest(
  path: string,
  opts: { user?: TestUser | null; formData: FormData; ip?: string } = { formData: new FormData() }
): NextRequest {
  const headers: Record<string, string> = {
    Origin: BASE_URL,
    Host: BASE_HOST,
    'sec-fetch-site': 'same-origin',
    'x-forwarded-for': opts.ip ?? `test-client-${randomUUID()}`,
  }
  if (opts.user) headers.Cookie = opts.user.cookie

  return new NextRequest(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: opts.formData,
  })
}

/** Wraps a dynamic-route param object the way Next.js hands it to a Route Handler. */
export function testParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) }
}

/** Deletes everything created under a given office — call in afterEach/afterAll. */
export async function cleanupOffice(officeId: string) {
  const users = await prisma.user.findMany({ where: { officeId }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.aiUsageLog.deleteMany({ where: { officeId } })
  await prisma.notification.deleteMany({ where: { officeId } })
  await prisma.calendarEvent.deleteMany({ where: { officeId } })
  await prisma.auditLog.deleteMany({ where: { officeId } })
  await prisma.timeEntry.deleteMany({ where: { officeId } })
  // Must precede document.deleteMany — DocumentSignature FKs to Document.
  await prisma.documentSignature.deleteMany({ where: { officeId } })
  await prisma.document.deleteMany({ where: { officeId } })
  await prisma.session.deleteMany({ where: { officeId } })
  await prisma.invoice.deleteMany({ where: { officeId } })
  await prisma.case.deleteMany({ where: { officeId } })
  await prisma.client.deleteMany({ where: { officeId } })
  await prisma.subscription.deleteMany({ where: { officeId } })
  await prisma.user.updateMany({ where: { officeId }, data: { clientId: null } })
  await prisma.user.deleteMany({ where: { officeId } })
  await prisma.office.delete({ where: { id: officeId } }).catch(() => {})
}

export async function readJson(res: Response) {
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
