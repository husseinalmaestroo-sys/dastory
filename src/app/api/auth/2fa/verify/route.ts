import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceRequestSecurity, isHttpsRequest } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { signToken, verifyToken } from '@/lib/jwt'
import { verifyTotpCode } from '@/lib/totp'
import { resolveAndMigrateSecret } from '@/lib/secret-crypto'
import { isPlatformAdminEmail } from '@/lib/auth-server'

export async function POST(req: NextRequest) {
  try {
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
    const secret = await resolveAndMigrateSecret(user.twoFactorSecret, (encrypted) =>
      prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypted } })
    )
    if (!verifyTotpCode(secret, code)) {
      await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.2fa_login_failed', {
        metadata: { reason: 'invalid_code' },
      })
      return NextResponse.json({ error: 'رمز التحقق غير صحيح' }, { status: 401 })
    }

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
        isPlatformAdmin: user.role === 'OFFICE_MANAGER' && isPlatformAdminEmail(user.email),
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
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
