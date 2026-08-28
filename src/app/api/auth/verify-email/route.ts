import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { enforceRequestSecurity } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'

export const POST = withErrorHandling(async (req: NextRequest) => {
  const blocked = enforceRequestSecurity(req, 'auth:verify-email', { limit: 10, windowMs: 10 * 60_000 })
  if (blocked) return blocked

  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) return NextResponse.json({ error: 'رمز التأكيد مطلوب' }, { status: 400 })

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } })

  // Same "generic failure, no detail leak" posture as reset-password: don't
  // distinguish "wrong token" from "expired" from "already used" in the
  // response — all three become one indistinguishable outcome to a caller
  // that doesn't already possess a still-valid token.
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json({ error: 'رابط التأكيد غير صالح أو منتهي الصلاحية' }, { status: 400 })
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ])

  await auditLog(req, { id: user.id, email: user.email, role: user.role, officeId: user.officeId }, 'auth.email_verified')
  return NextResponse.json({ ok: true })
})
