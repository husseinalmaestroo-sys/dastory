import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { enforceRequestSecurity } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'

export const POST = withErrorHandling(async (req: NextRequest) => {
  const blocked = enforceRequestSecurity(req, 'auth:reset-password', { limit: 20, windowMs: 60 * 60_000 })
  if (blocked) return blocked

  const payload = await req.json().catch(() => null)
  const token = typeof payload?.token === 'string' ? payload.token.trim() : ''
  const password = typeof payload?.password === 'string' ? payload.password : ''

  if (!token) return NextResponse.json({ error: 'رابط إعادة التعيين غير صالح' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 })

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return NextResponse.json({ error: 'الرابط غير صالح أو منتهي الصلاحية، يرجى طلب رابط جديد' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: resetToken.userId } })
  if (!user || !user.active) {
    return NextResponse.json({ error: 'الحساب غير موجود أو معطّل' }, { status: 400 })
  }

  const hashed = await bcrypt.hash(password, 10)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      // Completing a reset proves control of the inbox the link was sent to,
      // which is exactly what email verification establishes.
      data: { password: hashed, sessionVersion: { increment: 1 }, emailVerified: true },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ])

  await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.password_reset_completed')

  return NextResponse.json({ ok: true })
})
