import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'
import { enforceRequestSecurity, isHttpsRequest } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { isPlatformAdminEmail } from '@/lib/auth-server'
import { issueAndSendVerificationEmail } from '@/lib/email-verification'
import { startTrialSubscription } from '@/lib/billing'

function isValidEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export async function POST(req: NextRequest) {
  try {
    const blocked = enforceRequestSecurity(req, 'auth:signup', { limit: 5, windowMs: 10 * 60_000 })
    if (blocked) return blocked

    const payload = await req.json().catch(() => null)
    const { name, officeName, email, password, phone, barNumber } = payload ?? {}
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : ''
    const fullName = typeof name === 'string' ? name.trim() : ''
    const cleanOfficeName = typeof officeName === 'string' ? officeName.trim() : ''

    if (!fullName || fullName.length > 120 || cleanOfficeName.length > 140 || !isValidEmail(normalizedEmail) || typeof password !== 'string') {
      return NextResponse.json({ error: 'الاسم والبريد وكلمة المرور مطلوبة' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 409 })

    const hashed = await bcrypt.hash(password, 10)
    const created = await prisma.$transaction(async (tx) => {
      const office = await tx.office.create({
        data: {
          name: cleanOfficeName || `مكتب ${fullName}`,
          phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        },
      })

      const user = await tx.user.create({
        data: {
          name: fullName,
          email: normalizedEmail,
          password: hashed,
          role: 'OFFICE_MANAGER',
          phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
          barNumber: typeof barNumber === 'string' && barNumber.trim() ? barNumber.trim() : null,
          officeId: office.id,
        },
        include: { office: { select: { name: true } } },
      })

      return user
    })

    const token = signToken({
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      officeId: created.officeId,
      clientId: null,
      sessionVersion: created.sessionVersion,
      twoFactorVerified: true,
    })

    const res = NextResponse.json({
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        officeId: created.officeId,
        officeName: created.office.name,
        isPlatformAdmin: created.role === 'OFFICE_MANAGER' && isPlatformAdminEmail(created.email),
        barNumber: created.barNumber,
        clientId: null,
        twoFactorEnabled: created.twoFactorEnabled,
        emailVerified: created.emailVerified,
      },
    }, { status: 201 })

    res.cookies.set('ds_token', token, {
      httpOnly: true,
      secure: isHttpsRequest(req),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })

    await auditLog(req, { id: created.id, email: created.email, role: created.role, officeId: created.officeId }, 'auth.signup_success', {
      entityType: 'office',
      entityId: created.officeId,
      metadata: { officeName: created.office.name },
    })

    // Best-effort: a transient mail failure shouldn't fail account
    // creation. The user can always trigger a resend once logged in.
    try {
      await issueAndSendVerificationEmail(req, created)
    } catch (err) {
      console.error('[signup] failed to send verification email', err)
    }
    // Also best-effort — see startTrialSubscription's own try/catch.
    await startTrialSubscription(created.officeId)

    return res
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
