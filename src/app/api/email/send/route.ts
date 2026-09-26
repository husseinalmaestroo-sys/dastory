import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { clientVisibilityWhere } from '@/lib/tenant-scope'
import { resolveEmailAuthorization } from '@/lib/email-authorization'
import { escapeHtml, isSmtpConfigured, sendMail } from '@/lib/email'
import { withErrorHandling } from '@/lib/api-handler'

function isValidEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}


// Per-office ceiling on relayed mail, on top of the per-user hourly limit:
// offices are self-service, so without it a batch of accounts in one office
// could each use their full hourly allowance. Counted from the audit log
// ('email.sent' rows), which every successful send already writes.
export const OFFICE_DAILY_EMAIL_CAP = 100

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  // Relaying mail through the platform's SMTP account is the most abuse-prone
  // action a self-signed-up account has; a proven mailbox is required first.
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) {
    await auditLog(req, auth.user, 'email.send_blocked', { metadata: { reason: 'email_not_verified' } })
    return unverified
  }

  const limited = rateLimit(req, `email:send:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const payload = await req.json().catch(() => null)
  const { to, subject, body } = payload ?? {}
  if (!isValidEmail(to) || typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'البيانات ناقصة أو غير صحيحة' }, { status: 400 })
  }
  if (to.length > 254 || subject.length > 180 || body.length > 20_000) {
    return NextResponse.json({ error: 'حجم الرسالة أكبر من المسموح' }, { status: 400 })
  }

  const normalizedTo = to.trim().toLowerCase()
  // Header-safety: no control characters in the subject line.
  const cleanSubject = subject.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()

  const [matchedClient, matchedColleague] = await Promise.all([
    prisma.client.findFirst({
      where: clientVisibilityWhere(auth.user, { email: normalizedTo, active: true }),
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

  const sentToday = await prisma.auditLog.count({
    where: { officeId: auth.user.officeId, action: 'email.sent', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
  })
  if (sentToday >= OFFICE_DAILY_EMAIL_CAP) {
    await auditLog(req, auth.user, 'email.send_blocked', { metadata: { to: normalizedTo, reason: 'office_daily_cap' } })
    return NextResponse.json({ error: 'تم بلوغ الحد اليومي للرسائل المرسلة من هذا المكتب — حاول غداً' }, { status: 429 })
  }

  if (!isSmtpConfigured()) {
    await auditLog(req, auth.user, 'email.send_failed', { metadata: { reason: 'smtp_not_configured' } })
    return NextResponse.json(
      { error: 'البريد الإلكتروني غير معد على الخادم — تواصل مع مسؤول المنصة' },
      { status: 503 }
    )
  }

  try {
    await sendMail({
      to: normalizedTo,
      subject: cleanSubject,
      text: body,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;font-size:14px">${escapeHtml(body).replace(/\n/g, '<br>')}</div>`,
    })
  } catch (err) {
    console.error('[email/send] SMTP send failed', err)
    await auditLog(req, auth.user, 'email.send_failed', { metadata: { reason: 'smtp_error' } })
    return NextResponse.json({ error: 'تعذّر إرسال الرسالة عبر خادم البريد — حاول لاحقاً' }, { status: 502 })
  }

  await auditLog(req, auth.user, 'email.sent', {
    metadata: { to: normalizedTo, subjectLength: cleanSubject.length, authorizedVia: authz.reason },
  })
  return NextResponse.json({ ok: true })
})
