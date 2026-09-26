import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { accountThrottle, clearAccountFailures, enforceRequestSecurity, isHttpsRequest, recordAccountFailure } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { auditLog } from '@/lib/audit'
import { signToken, verifyToken } from '@/lib/jwt'
import { verifyTotpCode } from '@/lib/totp'
import { resolveAndMigrateSecret } from '@/lib/secret-crypto'
import { isPlatformAdmin } from '@/lib/auth-server'

export const POST = withErrorHandling(async (req: NextRequest) => {
    const blocked = enforceRequestSecurity(req, 'auth:2fa-verify', { limit: 12, windowMs: 60_000 })
    if (blocked) return blocked

    const token = req.cookies.get('ds_token')?.value
    const payload = token ? verifyToken(token) : null
    if (!payload) return NextResponse.json({ error: 'جلسة التحقق منتهية' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const code = body?.code

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { office: { select: { name: true, active: true } } },
    })

    if (!user || !user.active || !user.office?.active || (payload.sessionVersion ?? 0) !== user.sessionVersion) {
      return NextResponse.json({ error: 'جلسة التحقق منتهية' }, { status: 401 })
    }
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return NextResponse.json({ error: 'المصادقة الثنائية غير مفعلة لهذا الحساب' }, { status: 400 })
    }
    // A 6-digit code has 10^6 values; bound guesses per account, not just per IP.
    const throttleKey = `2fa:${user.id}`
    const throttled = accountThrottle(throttleKey, 10)
    if (throttled) return throttled
    const secret = await resolveAndMigrateSecret(user.twoFactorSecret, (encrypted) =>
      prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypted } })
    )
    if (!verifyTotpCode(secret, code)) {
      recordAccountFailure(throttleKey, 15 * 60_000)
      await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.2fa_login_failed', {
        metadata: { reason: 'invalid_code' },
      })
      return NextResponse.json({ error: 'رمز التحقق غير صحيح' }, { status: 401 })
    }

    clearAccountFailures(throttleKey)
    const fullToken = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      officeId: user.officeId,
      clientId: user.clientId ?? null,
      sessionVersion: user.sessionVersion,
      twoFactorVerified: true,
    })

    const res = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        officeId: user.officeId,
        officeName: user.office?.name ?? null,
        isPlatformAdmin: isPlatformAdmin(user),
        barNumber: user.barNumber,
        clientId: user.clientId ?? null,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    })

    res.cookies.set('ds_token', fullToken, {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })

    await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.2fa_login_success')
    return res
})
