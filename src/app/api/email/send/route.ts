import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { clientVisibilityWhere } from '@/lib/tenant-scope'
import { resolveEmailAuthorization } from '@/lib/email-authorization'

function isValidEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOfficeUser(req)
    if (!auth.ok) return auth.response
    const limited = rateLimit(req, `email:send:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
    if (limited) return limited

    const payload = await req.json().catch(() => null)
    const { to, subject, body } = payload ?? {}
    if (!isValidEmail(to) || typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
      return NextResponse.json({ error: 'البيانات ناقصة أو غير صحيحة' }, { status: 400 })
    }
    if (subject.length > 180 || body.length > 20_000) {
      return NextResponse.json({ error: 'حجم الرسالة أكبر من المسموح' }, { status: 400 })
    }

    const normalizedTo = to.trim().toLowerCase()

    const [matchedClient, matchedColleague] = await Promise.all([
      prisma.client.findFirst({
        where: clientVisibilityWhere(auth.user, { email: normalizedTo }),
        select: { officeId: true, email: true },
      }),
      prisma.user.findFirst({
        where: { officeId: auth.user.officeId, email: normalizedTo, active: true },
        select: { officeId: true, email: true },
      }),
    ])

    const authz = resolveEmailAuthorization(auth.user, { matchedClient, matchedColleague })
    if (!authz.allowed) {
      await auditLog(req, auth.user, 'email.send_blocked', {
        metadata: { to: normalizedTo, reason: authz.reason },
      })
      return NextResponse.json({ error: 'المستلم غير مرتبط بحساباتك — لا يمكن إرسال بريد له' }, { status: 403 })
    }

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      await auditLog(req, auth.user, 'email.send_failed', { metadata: { reason: 'smtp_not_configured' } })
      return NextResponse.json(
        { error: 'البريد الإلكتروني غير معد. أضف SMTP_HOST و SMTP_USER و SMTP_PASS في .env' },
        { status: 503 }
      )
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT ?? '587'),
      secure: SMTP_PORT === '465',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })

    await transporter.sendMail({
      from: SMTP_FROM ?? SMTP_USER,
      to: normalizedTo,
      subject: subject.trim(),
      text: body,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;font-size:14px">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`,
    })

    await auditLog(req, auth.user, 'email.sent', {
      metadata: { to: normalizedTo, subjectLength: subject.trim().length, authorizedVia: authz.reason },
    })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error(err)
    return NextResponse.json({ error: 'فشل الإرسال' }, { status: 500 })
  }
}
