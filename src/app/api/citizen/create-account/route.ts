import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager, requireVerifiedEmail } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { isValidEmail, validatePassword } from '@/lib/validation'

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified
  const limited = rateLimit(req, `citizen:create:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const payload = await req.json().catch(() => null)
  const { clientId, email, password } = payload ?? {}
  if (typeof clientId !== 'string' || !clientId || !isValidEmail(email) || typeof password !== 'string') {
    return NextResponse.json({ error: 'البيانات ناقصة' }, { status: 400 })
  }
  const passwordError = validatePassword(password)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
  const normalizedEmail = email.toLowerCase().trim()

  // The client must be a live client of THIS office.
  const client = await prisma.client.findFirst({
    where: { id: clientId, officeId: auth.user.officeId, active: true },
    include: { citizenUser: true },
  })
  if (!client) return NextResponse.json({ error: 'الموكل غير موجود' }, { status: 404 })
  if (client.citizenUser) return NextResponse.json({ error: 'حساب المواطن موجود مسبقاً' }, { status: 409 })

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 409 })

  const hashed = await bcrypt.hash(password, 10)
  // A concurrent duplicate (same email, or same clientId — both unique)
  // surfaces as P2002 and withErrorHandling answers 409.
  const citizenUser = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password: hashed,
      name: client.name,
      role: 'CITIZEN',
      officeId: auth.user.officeId,
      clientId: client.id,
    },
  })

  await auditLog(req, auth.user, 'citizen.account_created', {
    entityType: 'user',
    entityId: citizenUser.id,
    metadata: { clientId: client.id },
  })
  return NextResponse.json({ id: citizenUser.id, email: citizenUser.email, name: citizenUser.name })
})
