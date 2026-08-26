import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { InvoiceStatus } from '@prisma/client'
import { invoiceVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'

const INVOICE_STATUSES = new Set<string>(Object.values(InvoiceStatus))

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const existing = await prisma.invoice.findFirst({
    where: invoiceVisibilityWhere(auth.user, { id }),
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  let nextAmount = existing.amount
  let nextPaid = existing.paid

  if (body.amount !== undefined) {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'مبلغ الفاتورة غير صالح' }, { status: 400 })
    data.amount = amount
    nextAmount = amount
  }
  if (body.paid !== undefined) {
    const paid = Number(body.paid)
    if (!Number.isFinite(paid) || paid < 0) return NextResponse.json({ error: 'المبلغ المدفوع غير صالح' }, { status: 400 })
    data.paid = paid
    nextPaid = paid
  }
  if (nextPaid > nextAmount) {
    return NextResponse.json({ error: 'المبلغ المدفوع لا يمكن أن يتجاوز مبلغ الفاتورة' }, { status: 400 })
  }
  if (typeof body.status === 'string') {
    if (!INVOICE_STATUSES.has(body.status)) return NextResponse.json({ error: 'حالة الفاتورة غير صالحة' }, { status: 400 })
    data.status = body.status
  }
  if ('dueDate' in body) {
    if (typeof body.dueDate === 'string' && body.dueDate.trim()) {
      const dueDate = new Date(body.dueDate)
      if (Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: 'تاريخ الاستحقاق غير صالح' }, { status: 400 })
      data.dueDate = dueDate
    } else {
      data.dueDate = null
    }
  }
  if ('notes' in body) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  const updated = await prisma.invoice.update({
    where: { id: existing.id },
    data,
    include: { client: { select: { name: true } }, case: { select: { number: true, title: true } } },
  })
  await auditLog(req, auth.user, 'invoice.updated', {
    entityType: 'invoice',
    entityId: updated.id,
    metadata: { fields: Object.keys(data) },
  })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await prisma.invoice.findFirst({
    where: invoiceVisibilityWhere(auth.user, { id }),
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  await prisma.invoice.delete({ where: { id: existing.id } })
  await auditLog(req, auth.user, 'invoice.deleted', { entityType: 'invoice', entityId: existing.id })
  return NextResponse.json({ ok: true })
}
