import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { clientVisibilityWhere, clientWritableWhere, clientOwnedWhere, invoiceVisibilityWhere, caseVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { jsonWithMoney } from '@/lib/money'
import { isValidEmail, validateFields } from '@/lib/validation'
import { CLIENT_FIELDS } from '@/lib/field-specs'

export const GET = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:read:${auth.user.id}`, { limit: 600, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params

  const client = await prisma.client.findFirst({
    where: clientVisibilityWhere(auth.user, { id }),
    include: {
      cases: {
        where: caseVisibilityWhere(auth.user),
        select: { id: true, number: true, title: true, status: true, court: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      invoices: {
        where: invoiceVisibilityWhere(auth.user),
        select: { id: true, number: true, amount: true, paid: true, status: true, dueDate: true },
        orderBy: { createdAt: 'desc' },
      },
      citizenUser: { select: { id: true, email: true, active: true } },
    },
  })

  if (!client) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  return jsonWithMoney(client)
})

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
  const v = validateFields(body, CLIENT_FIELDS)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  if (v.values.email && !isValidEmail(v.values.email)) {
    return NextResponse.json({ error: 'البريد الإلكتروني غير صحيح' }, { status: 400 })
  }

  const client = await prisma.client.findFirst({
    where: clientWritableWhere(auth.user, { id, active: true }),
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if ('name' in body) {
    if (!v.values.name) return NextResponse.json({ error: 'اسم العميل مطلوب' }, { status: 400 })
    data.name = v.values.name
  }
  if ('phone' in body) data.phone = v.values.phone ?? null
  if ('email' in body) data.email = v.values.email ? v.values.email.toLowerCase() : null
  if ('idNumber' in body) data.idNumber = v.values.idNumber ?? null
  if ('address' in body) data.address = v.values.address ?? null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  const updated = await prisma.client.update({ where: { id: client.id }, data })
  await auditLog(req, auth.user, 'client.updated', {
    entityType: 'client',
    entityId: updated.id,
    metadata: { fields: Object.keys(data) },
  })
  return NextResponse.json(updated)
})

export const DELETE = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const client = await prisma.client.findFirst({
    where: clientOwnedWhere(auth.user, { id, active: true }),
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  await prisma.client.update({ where: { id: client.id }, data: { active: false } })
  await auditLog(req, auth.user, 'client.deleted', {
    entityType: 'client',
    entityId: client.id,
  })
  return NextResponse.json({ ok: true })
})
