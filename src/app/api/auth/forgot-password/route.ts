import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { enforceRequestSecurity } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { appOrigin, escapeHtml, isSmtpConfigured, reportUndeliveredLink, sendMail } from '@/lib/email'
import { withErrorHandling } from '@/lib/api-handler'
import { isValidEmail } from '@/lib/validation'

const GENERIC_MESSAGE = 'إذا كان هذا البريد مسجلاً لدينا، سيصلك رابط لإعادة تعيين كلمة المرور خلال دقائق.'

export const POST = withErrorHandling(async (req: NextRequest) => {
  const blocked = enforceRequestSecurity(req, 'auth:forgot-password', { limit: 5, windowMs: 10 * 60_000 })
  if (blocked) return blocked

  const payload = await req.json().catch(() => null)
  const email = typeof payload?.email === 'string' ? payload.email.toLowerCase().trim() : ''
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'أدخل بريداً إلكترونياً صحيحاً' }, { status: 400 })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, officeId: true, active: true, office: { select: { active: true } } },
    })

    if (user?.active && user.office?.active) {
      const token = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(token).digest('hex')
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) },
      })

      const resetLink = `${appOrigin()}/login?resetToken=${token}`

      if (isSmtpConfigured()) {
        await sendMail({
          to: user.email,
          subject: 'إعادة تعيين كلمة المرور — دُسْتُورِي',
          text: `مرحباً ${user.name}،\n\nاضغط على الرابط التالي لإعادة تعيين كلمة المرور (صالح لمدة 30 دقيقة):\n${resetLink}\n\nإذا لم تطلب هذا، تجاهل هذه الرسالة.`,
          html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;font-size:14px">مرحباً ${escapeHtml(user.name)}،<br><br>اضغط على الرابط التالي لإعادة تعيين كلمة المرور (صالح لمدة 30 دقيقة):<br><a href="${resetLink}">${resetLink}</a><br><br>إذا لم تطلب هذا، تجاهل هذه الرسالة.</div>`,
        })
      } else {
        reportUndeliveredLink('password-reset', user.id, resetLink)
      }

      await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.password_reset_requested')
    }
  } catch (err) {
    // Deliberately the same generic answer whether or not this failed, so
    // the response never reveals whether the address has an account.
    console.error('[forgot-password] failed to issue/send reset link', err)
  }

  return NextResponse.json({ ok: true, message: GENERIC_MESSAGE })
})
