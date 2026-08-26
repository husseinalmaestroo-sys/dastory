import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'
import { enforceRequestSecurity, isHttpsRequest } from '@/lib/api-security'
import { isPlatformAdminEmail } from '@/lib/auth-server'
import { auditLog } from '@/lib/audit'

function userPayload(user: {
  id: string
  email: string
  name: string
  role: 'OFFICE_MANAGER' | 'LAWYER' | 'CITIZEN'
  officeId: string
  clientId: string | null
  sessionVersion: number
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    officeId: user.officeId,
    clientId: user.clientId ?? null,
    sessionVersion: user.sessionVersion,
  }
}

export async function POST(req: NextRequest) {
  try {
    const blocked = enforceRequestSecurity(req, 'auth:login', { limit: 8, windowMs: 60_000 })
    if (blocked) return blocked

    const payload = await req.json().catch(() => null)
    const { email, password } = payload ?? {}
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : ''

    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'البريد وكلمة المرور مطلوبان' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { office: { select: { name: true, active: true } } },
    })

    if (!user || !user.active || !user.office?.active) {
      await auditLog(req, null, 'auth.login_failed', {
        actorEmail: normalizedEmail,
        metadata: { reason: 'not_found_or_inactive' },
      })
      return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.login_failed', {
        metadata: { reason: 'invalid_password' },
      })
      return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
    }

    const basePayload = userPayload(user)

    if (user.twoFactorEnabled) {
      const token = signToken({ ...basePayload, twoFactorVerified: false }, { expiresIn: '10m' })
      const res = NextResponse.json({
        requires2FA: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          officeId: user.officeId,
          officeName: user.office?.name ?? null,
        },
      })

      res.cookies.set('ds_token', token, {
        httpOnly: true,
        secure: isHttpsRequest(req),
        sameSite: 'lax',
        maxAge: 60 * 10,
        path: '/',
      })

      await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.login_2fa_required')
      return res
    }

    const token = signToken({ ...basePayload, twoFactorVerified: true })
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

    res.cookies.set('ds_token', token, {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })

    await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.login_success')
    return res
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
