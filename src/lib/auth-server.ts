import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from './jwt'
import { prisma } from '@/lib/prisma'
import { rejectCrossSite } from '@/lib/api-security'
import { getSubscriptionEnforcement } from '@/lib/billing'

export function getUser(req: NextRequest): JWTPayload | null {
  return getTokenPayload(req.cookies.get('ds_token')?.value)
}

export function getTokenPayload(token: string | undefined): JWTPayload | null {
  if (!token) return null
  return verifyToken(token)
}

type AuthResult<T extends JWTPayload> =
  | { ok: true; user: T }
  | { ok: false; response: NextResponse }

type OfficeUser = ActiveUser & { officeId: string }
type OfficeManager = OfficeUser & { role: 'OFFICE_MANAGER' }
type CitizenUser = ActiveUser & { role: 'CITIZEN'; officeId: string; clientId: string }
// emailVerified is deliberately NOT part of the JWT payload itself (like
// active/twoFactorEnabled, it's re-checked fresh from the DB on every
// request below, not trusted from a token that could be stale for days).
export type ActiveUser = JWTPayload & { emailVerified: boolean }
type PlatformAdmin = OfficeManager & { isPlatformAdmin: true }

export function isPlatformAdminEmail(email: string) {
  const configured = process.env.PLATFORM_ADMIN_EMAILS || 'admin@dostoori.jo'
  return configured
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

function unauthorized() {
  return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
}

function forbidden() {
  return NextResponse.json({ error: 'لا تملك صلاحية الوصول' }, { status: 403 })
}

function subscriptionExpired() {
  return NextResponse.json(
    { error: 'انتهت صلاحية اشتراك المكتب — يرجى التواصل مع الدعم لإعادة التفعيل', code: 'subscription_expired' },
    { status: 402 }
  )
}

type OfficeAccessOptions = {
  /**
   * Skip subscription enforcement for this call. For the small set of
   * routes an office needs even while blocked: checking its own billing
   * status (how would it otherwise know why it's locked out?) and
   * exporting its data before it's shut out entirely.
   */
  skipSubscriptionCheck?: boolean
}

/** Null = allowed. A read during 'grace' is allowed; everything else in 'grace'/'blocked' is not — see getSubscriptionEnforcement in billing.ts for the tier rules. */
async function subscriptionGate(officeId: string, method: string): Promise<NextResponse | null> {
  const { tier } = await getSubscriptionEnforcement(officeId)
  if (tier === 'active') return null
  const isRead = method === 'GET' || method === 'HEAD'
  if (tier === 'grace' && isRead) return null
  return subscriptionExpired()
}

/**
 * Core active-session check, keyed by raw token rather than a NextRequest.
 * Reused by API routes (via getActiveUser, below) and by Server Components /
 * layouts, which read the ds_token cookie through next/headers instead of a
 * NextRequest — see src/lib/session.ts.
 */
export async function getActiveUserFromToken(token: string | undefined): Promise<ActiveUser | null> {
  const payload = getTokenPayload(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      officeId: true,
      clientId: true,
      sessionVersion: true,
      twoFactorEnabled: true,
      emailVerified: true,
      active: true,
      office: { select: { active: true } },
    },
  })

  if (!user?.active || !user.office?.active) return null
  if ((payload.sessionVersion ?? 0) !== user.sessionVersion) return null
  if (user.twoFactorEnabled && payload.twoFactorVerified !== true) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    clientId: user.clientId ?? null,
    sessionVersion: user.sessionVersion,
    twoFactorVerified: user.twoFactorEnabled ? true : payload.twoFactorVerified,
    emailVerified: user.emailVerified,
  }
}

export async function requireActiveUser(req: NextRequest): Promise<AuthResult<ActiveUser>> {
  const crossSite = rejectCrossSite(req)
  if (crossSite) return { ok: false, response: crossSite }

  const user = await getActiveUserFromToken(req.cookies.get('ds_token')?.value)
  if (!user) return { ok: false, response: unauthorized() }
  return { ok: true, user }
}

export async function requireOfficeUser(req: NextRequest, opts: OfficeAccessOptions = {}): Promise<AuthResult<OfficeUser>> {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth
  const user = auth.user
  if (!user.officeId || user.role === 'CITIZEN') return { ok: false, response: forbidden() }
  const officeUser: OfficeUser = { ...user, officeId: user.officeId }

  // Platform admins are exempt from their own office's subscription state —
  // they're the ones who manage everyone else's, and must never be locked
  // out of /admin by the very thing they're there to fix.
  if (!opts.skipSubscriptionCheck && !isPlatformAdminEmail(user.email)) {
    const blocked = await subscriptionGate(officeUser.officeId, req.method)
    if (blocked) return { ok: false, response: blocked }
  }

  return { ok: true, user: officeUser }
}

export async function requireOfficeManager(req: NextRequest, opts: OfficeAccessOptions = {}): Promise<AuthResult<OfficeManager>> {
  const auth = await requireOfficeUser(req, opts)
  if (!auth.ok) return { ok: false, response: auth.response }
  if (auth.user.role !== 'OFFICE_MANAGER') return { ok: false, response: forbidden() }
  return { ok: true, user: auth.user as OfficeManager }
}

export async function requirePlatformAdmin(req: NextRequest): Promise<AuthResult<PlatformAdmin>> {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return { ok: false, response: auth.response }
  if (!isPlatformAdminEmail(auth.user.email)) return { ok: false, response: forbidden() }
  return { ok: true, user: { ...auth.user, isPlatformAdmin: true } }
}

export async function requireCitizenUser(req: NextRequest): Promise<AuthResult<CitizenUser>> {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth
  const user = auth.user
  if (user.role !== 'CITIZEN' || !user.officeId || !user.clientId) return { ok: false, response: forbidden() }
  return { ok: true, user: { ...user, role: 'CITIZEN', officeId: user.officeId, clientId: user.clientId } }
}
