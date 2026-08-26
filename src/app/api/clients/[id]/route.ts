import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { clientVisibilityWhere, clientWritableWhere, clientOwnedWhere, invoiceVisibilityWhere, caseVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
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
  return NextResponse.json(client)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const client = await prisma.client.findFirst({
    where: clientWritableWhere(auth.user, { id, active: true }),
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    if (!body.name.trim()) return NextResponse.json({ error: 'اسم العميل مطلوب' }, { status: 400 })
    data.name = body.name.trim()
  }
  if ('phone' in body) data.phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
  if ('email' in body) data.email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
  if ('idNumber' in body) data.idNumber = typeof body.idNumber === 'string' && body.idNumber.trim() ? body.idNumber.trim() : null
  if ('address' in body) data.address = typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null

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
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

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
}
