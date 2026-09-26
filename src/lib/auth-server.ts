import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, JWTPayload } from './jwt'
import { prisma } from '@/lib/prisma'
import { rejectCrossSite } from '@/lib/api-security'
import { getSubscriptionEnforcement } from '@/lib/billing'
import { PLATFORM_ADMIN_EMAILS } from '@/lib/env'

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
// emailVerified / twoFactorEnabled / isPlatformAdmin are deliberately NOT
// trusted from the JWT: like `active`, they're re-read from the DB on every
// request below, not taken from a token that could be days old.
export type ActiveUser = JWTPayload & {
  emailVerified: boolean
  twoFactorEnabled: boolean
  /** Effective platform-admin status (see isPlatformAdmin) — never the raw DB flag. */
  isPlatformAdmin: boolean
  /** Raw DB flag: provisioned by an operator, possibly not yet effective. */
  platformAdminProvisioned: boolean
}
type PlatformAdmin = OfficeManager & { isPlatformAdmin: true }

export type PlatformAdminCandidate = {
  email: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  isPlatformAdmin: boolean
  emailVerified: boolean
  twoFactorEnabled: boolean
}

/**
 * Platform (cross-tenant) admin. ALL of these must hold — no single one is
 * enough, and none can be obtained through a public endpoint:
 *  1. `User.isPlatformAdmin` — set only by the operator CLI
 *     (scripts/platform-admin.mjs); no HTTP route ever writes it.
 *  2. the email is listed in PLATFORM_ADMIN_EMAILS (required env, no default).
 *  3. the email is verified.
 *  4. 2FA is enabled — and getActiveUserFromToken already rejects any session
 *     for a 2FA-enabled user that didn't complete the second factor.
 *  5. role OFFICE_MANAGER.
 * Previously (1)(3)(4) didn't exist and (2) defaulted to a fixed address, so
 * self-registering that address at /signup made you platform admin.
 */
export function isPlatformAdmin(user: PlatformAdminCandidate): boolean {
  return (
    user.role === 'OFFICE_MANAGER' &&
    user.isPlatformAdmin === true &&
    user.emailVerified === true &&
    user.twoFactorEnabled === true &&
    PLATFORM_ADMIN_EMAILS.has(user.email.toLowerCase())
  )
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
      isPlatformAdmin: true,
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
    twoFactorEnabled: user.twoFactorEnabled,
    isPlatformAdmin: isPlatformAdmin(user),
    platformAdminProvisioned: user.isPlatformAdmin,
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
  if (!opts.skipSubscriptionCheck && !user.isPlatformAdmin) {
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
  if (!auth.user.isPlatformAdmin) {
    // A provisioned operator who hasn't finished securing the account gets
    // told what's missing; anyone else gets the generic 403.
    if (auth.user.platformAdminProvisioned) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'حساب مدير المنصة يتطلب بريداً إلكترونياً مؤكَّداً ومصادقة ثنائية مفعّلة', code: 'platform_admin_requirements' },
          { status: 403 }
        ),
      }
    }
    return { ok: false, response: forbidden() }
  }
  return { ok: true, user: { ...auth.user, isPlatformAdmin: true } }
}

/**
 * Gate for features that need a proven mailbox: AI (spends money, sends
 * client material to an external service), the email relay, and creating
 * accounts for other people. 403 with a stable `code` the UI can act on.
 */
export function requireVerifiedEmail(user: Pick<ActiveUser, 'emailVerified'>): NextResponse | null {
  if (user.emailVerified) return null
  return NextResponse.json(
    { error: 'يجب تأكيد بريدك الإلكتروني قبل استخدام هذه الميزة — أعد إرسال رابط التأكيد من صفحة الإعدادات', code: 'email_not_verified' },
    { status: 403 }
  )
}

export async function requireCitizenUser(req: NextRequest): Promise<AuthResult<CitizenUser>> {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth
  const user = auth.user
  if (user.role !== 'CITIZEN' || !user.officeId || !user.clientId) return { ok: false, response: forbidden() }
  // The portal exists for a live client relationship: once the office
  // deactivates the client (soft delete), the linked login stops working.
  const client = await prisma.client.findFirst({
    where: { id: user.clientId, officeId: user.officeId, active: true },
    select: { id: true },
  })
  if (!client) return { ok: false, response: forbidden() }
  return { ok: true, user: { ...user, role: 'CITIZEN', officeId: user.officeId, clientId: user.clientId } }
}
