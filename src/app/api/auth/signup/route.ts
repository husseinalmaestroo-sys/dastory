import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/jwt'
import { enforceRequestSecurity, isHttpsRequest } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { isPlatformAdmin } from '@/lib/auth-server'
import { issueAndSendVerificationEmail } from '@/lib/email-verification'
import { startTrialSubscription } from '@/lib/billing'
import { withErrorHandling } from '@/lib/api-handler'
import { isValidEmail, LIMITS, textField, validatePassword } from '@/lib/validation'

export const POST = withErrorHandling(async (req: NextRequest) => {
    const blocked = enforceRequestSecurity(req, 'auth:signup', { limit: 5, windowMs: 10 * 60_000 })
    if (blocked) return blocked

    const payload = await req.json().catch(() => null)
    const { name, officeName, email, password, phone, barNumber } = payload ?? {}
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : ''
    const fullName = typeof name === 'string' ? name.trim() : ''
    const cleanOfficeName = typeof officeName === 'string' ? officeName.trim() : ''

    if (!fullName || fullName.length > LIMITS.personName || cleanOfficeName.length > LIMITS.officeName || !isValidEmail(normalizedEmail) || typeof password !== 'string') {
      return NextResponse.json({ error: 'الاسم والبريد وكلمة المرور مطلوبة' }, { status: 400 })
    }
    const passwordError = validatePassword(password)
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
    const phoneField = textField(phone, { label: 'الهاتف', max: LIMITS.phone })
    if (!phoneField.ok) return NextResponse.json({ error: phoneField.error }, { status: 400 })
    const barField = textField(barNumber, { label: 'رقم النقابة', max: LIMITS.barNumber })
    if (!barField.ok) return NextResponse.json({ error: barField.error }, { status: 400 })

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 409 })

    const hashed = await bcrypt.hash(password, 10)
    const created = await prisma.$transaction(async (tx) => {
      const office = await tx.office.create({
        data: {
          name: cleanOfficeName || `مكتب ${fullName}`,
          phone: phoneField.value ?? null,
        },
      })

      const user = await tx.user.create({
        data: {
          name: fullName,
          email: normalizedEmail,
          password: hashed,
          role: 'OFFICE_MANAGER',
          phone: phoneField.value ?? null,
          barNumber: barField.value ?? null,
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
        isPlatformAdmin: isPlatformAdmin(created),
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
      await issueAndSendVerificationEmail(created)
    } catch (err) {
      console.error('[signup] failed to send verification email', err)
    }
    // Also best-effort — see startTrialSubscription's own try/catch.
    await startTrialSubscription(created.officeId)

    return res
})
