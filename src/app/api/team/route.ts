import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager, requireOfficeUser } from '@/lib/auth-server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { staffVisibilityWhere, staffWritableWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'

function isValidEmail(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

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
  const limited = rateLimit(req, `team:create:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const { name, email, password, phone, barNumber } = body
  const memberRole = Role.LAWYER
  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : ''

  if (typeof name !== 'string' || !name.trim() || !isValidEmail(normalizedEmail) || typeof password !== 'string') {
    return NextResponse.json({ error: 'الحقول المطلوبة ناقصة أو غير صحيحة' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) return NextResponse.json({ error: 'البريد الإلكتروني مستخدم مسبقاً' }, { status: 400 })

  const hashed = await bcrypt.hash(password, 10)
  const member = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      password: hashed,
      role: memberRole,
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
      barNumber: typeof barNumber === 'string' && barNumber.trim() ? barNumber.trim() : null,
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
  if (typeof active === 'boolean') data.active = active
  if (typeof password === 'string' && password.length > 0) {
    if (password.length < 8) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' }, { status: 400 })
    }
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
