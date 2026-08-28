import { NextRequest, NextResponse } from 'next/server'
import { requireActiveUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { issueAndSendVerificationEmail } from '@/lib/email-verification'

// Requires an existing session (even an unverified one can call this) —
// keeps this from being an open "send mail to anyone" endpoint, which an
// unauthenticated version keyed only on an email address would be.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response

  if (auth.user.emailVerified) {
    return NextResponse.json({ error: 'بريدك الإلكتروني مؤكَّد بالفعل' }, { status: 400 })
  }

  // Tight: resend is meant for "I didn't get the email" / "it expired",
  // not a repeat-send button.
  const limited = rateLimit(req, `auth:verify-email:resend:${auth.user.id}`, { limit: 3, windowMs: 15 * 60_000 })
  if (limited) return limited

  await issueAndSendVerificationEmail(req, auth.user)
  return NextResponse.json({ ok: true, message: 'تم إرسال رابط تأكيد جديد إلى بريدك الإلكتروني' })
})
