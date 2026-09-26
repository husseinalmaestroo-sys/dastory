import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth-server'
import { prisma } from '@/lib/prisma'
import { auditLog } from '@/lib/audit'
import { isHttpsRequest, rejectCrossSite } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'

// Logout revokes the session server-side, not just the browser cookie: the
// JWT stays cryptographically valid until it expires (7 days), so clearing
// the cookie alone left any copied token usable. Bumping sessionVersion makes
// getActiveUserFromToken reject every token issued before now for this user —
// the same mechanism password reset and 2FA changes use. Consequence, by
// design: logging out signs this user out on all of their devices.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const blocked = rejectCrossSite(req)
  if (blocked) return blocked

  const user = getUser(req)
  if (user) {
    // Only a still-current token may revoke — a stale token is already dead
    // and must not be able to log the user's newer sessions out.
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion ?? 0 },
      data: { sessionVersion: { increment: 1 } },
    })
    if (count > 0) await auditLog(req, user, 'auth.logout')
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('ds_token', '', {
    httpOnly: true,
    secure: isHttpsRequest(req),
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return res
})
