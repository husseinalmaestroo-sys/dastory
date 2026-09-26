import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager, requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { staffVisibilityWhere, staffWritableWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { isValidEmail, validateFields, validatePassword } from '@/lib/validation'
import { STAFF_FIELDS, required } from '@/lib/field-specs'

const STAFF_FIELDS_CREATE = required(STAFF_FIELDS, 'name')

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const members = await prisma.user.findMany({
    where: staffVisibilityWhere(auth.user),
    select: {
      id: true, name: true, email: true, role: true, phone: true,
      barNumber: true, active: true, createdAt: true,
      _count: { select: { cases: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(members)
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response
  // Creating an account for someone else's email address requires the
  // creator's own address to be proven first.
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified
  const limited = rateLimit(req, `team:create:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const { email, password } = body
  const memberRole = Role.LAWYER
  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : ''

  if (!isValidEmail(normalizedEmail) || typeof password !== 'string') {
    return NextResponse.json({ error: 'الحقول المطلوبة ناقصة أو غير صحيحة' }, { status: 400 })
  }
  const v = validateFields(body, STAFF_FIELDS_CREATE)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const passwordError = validatePassword(password)
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })

  const hashed = await bcrypt.hash(password, 10)
  const member = await prisma.user.create({
    data: {
      name: v.values.name as string,
      email: normalizedEmail,
      password: hashed,
      role: memberRole,
      phone: v.values.phone ?? null,
      barNumber: v.values.barNumber ?? null,
      officeId: auth.user.officeId,
    },
    select: {
      id: true, name: true, email: true, role: true, phone: true,
      barNumber: true, active: true, createdAt: true,
      _count: { select: { cases: true } },
    },
  })

  await auditLog(req, auth.user, 'team.member_created', {
    entityType: 'user',
    entityId: member.id,
    metadata: { role: member.role },
  })
  return NextResponse.json(member, { status: 201 })
})

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `team:update:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const { id, active, password } = body
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'معرّف المستخدم مطلوب' }, { status: 400 })
  }

  const target = await prisma.user.findFirst({
    where: staffWritableWhere(auth.user, { id }),
  })
  if (!target) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
  if (id === auth.user.id && active === false) {
    return NextResponse.json({ error: 'لا يمكن تعطيل حسابك الحالي' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof active === 'boolean') {
    data.active = active
    // Deactivation also revokes every existing session, so reactivating the
    // account later doesn't bring old (possibly copied) tokens back to life.
    if (active === false) data.sessionVersion = { increment: 1 }
  }
  if (typeof password === 'string' && password.length > 0) {
    const passwordError = validatePassword(password)
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
    data.password = await bcrypt.hash(password, 10)
    data.sessionVersion = { increment: 1 }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  const updated = await prisma.user.update({ where: { id }, data, select: { id: true, active: true } })
  await auditLog(req, auth.user, 'team.member_updated', {
    entityType: 'user',
    entityId: updated.id,
    metadata: {
      changedActive: 'active' in data,
      passwordReset: 'password' in data,
    },
  })
  return NextResponse.json(updated)
})
