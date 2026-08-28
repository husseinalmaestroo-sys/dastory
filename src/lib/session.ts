import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getActiveUserFromToken, isPlatformAdminEmail, type ActiveUser } from '@/lib/auth-server'
import type { AuthUser } from '@/lib/dashboard/types'

/**
 * Reads and validates the current session from the ds_token cookie, for use
 * in Server Components / layouts (which get cookies via next/headers, not a
 * NextRequest). Runs the exact same active-session checks as the API routes
 * (getActiveUserFromToken in auth-server.ts): user + office active, session
 * version matches, 2FA verified if enabled.
 *
 * Wrapped in React.cache() — the dashboard layout and individual pages
 * (e.g. role-gated ones, or Settings needing the full profile) each call
 * this independently; cache() dedupes repeat calls within one request into
 * a single cookie read + DB round trip instead of one per caller.
 */
export const getSessionUser = cache(async (): Promise<ActiveUser | null> => {
  const store = await cookies()
  return getActiveUserFromToken(store.get('ds_token')?.value)
})

export async function isSessionPlatformAdmin(user: Pick<ActiveUser, 'email' | 'role'>): Promise<boolean> {
  return user.role === 'OFFICE_MANAGER' && isPlatformAdminEmail(user.email)
}

/**
 * The richer profile shape the dashboard UI renders (office name, bar
 * number, 2FA status, platform-admin flag) — same query /api/auth/me runs.
 * Also cached per-request so the layout and a page (e.g. Settings) can both
 * call it without doubling the DB hit.
 */
export const getFullAuthUser = cache(async (): Promise<AuthUser | null> => {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return null

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: { office: { select: { name: true } } },
  })
  if (!user) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId ?? '',
    officeName: user.office?.name ?? null,
    isPlatformAdmin: user.role === 'OFFICE_MANAGER' && isPlatformAdminEmail(user.email),
    barNumber: user.barNumber,
    clientId: user.clientId ?? null,
    twoFactorEnabled: user.twoFactorEnabled,
    emailVerified: user.emailVerified,
  }
})
