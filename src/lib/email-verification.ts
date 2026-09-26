import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { appOrigin, escapeHtml, isSmtpConfigured, reportUndeliveredLink, sendMail } from '@/lib/email'

const TOKEN_TTL_MS = 24 * 60 * 60_000 // 24h — longer-lived than a password reset token since it's lower-risk (confirms an inbox, doesn't grant access) and shouldn't force a re-send just because someone opened the email the next day.

/**
 * Issues a fresh single-use verification token (same hash-at-rest pattern
 * as PasswordResetToken — only the SHA-256 hash is stored, the raw token
 * only ever exists in the email link) and emails it. Used by both signup
 * (first send) and the resend endpoint.
 *
 * Silently no-ops if SMTP isn't configured, logging the link instead — same
 * behavior as forgot-password, so a missing mail relay doesn't block
 * account creation or crash signup.
 */
export async function issueAndSendVerificationEmail(
  user: { id: string; email: string; name: string }
): Promise<void> {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  })

  const verifyLink = `${appOrigin()}/login/verify-email?token=${token}`

  if (isSmtpConfigured()) {
    await sendMail({
      to: user.email,
      subject: 'تأكيد البريد الإلكتروني — دُسْتُورِي',
      text: `مرحباً ${user.name}،\n\nاضغط على الرابط التالي لتأكيد بريدك الإلكتروني (صالح لمدة 24 ساعة):\n${verifyLink}\n\nإذا لم تُنشئ حساباً على دُسْتُورِي، تجاهل هذه الرسالة.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;font-size:14px">مرحباً ${escapeHtml(user.name)}،<br><br>اضغط على الرابط التالي لتأكيد بريدك الإلكتروني (صالح لمدة 24 ساعة):<br><a href="${verifyLink}">${verifyLink}</a><br><br>إذا لم تُنشئ حساباً على دُسْتُورِي، تجاهل هذه الرسالة.</div>`,
    })
  } else {
    reportUndeliveredLink('email-verification', user.id, verifyLink)
  }
}
