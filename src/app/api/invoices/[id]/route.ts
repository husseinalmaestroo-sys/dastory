import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { InvoiceStatus, Prisma } from '@prisma/client'
import { invoiceVisibilityWhere, isOfficeManager } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { invoiceDeletionGuard, paymentCorrectionGuard, resolveInvoiceStatus } from '@/lib/financial-guards'
import { withErrorHandling } from '@/lib/api-handler'
import { jsonWithMoney, parseMoney } from '@/lib/money'
import { validateFields } from '@/lib/validation'
import { INVOICE_FIELDS } from '@/lib/field-specs'

const INVOICE_STATUSES = new Set<string>(Object.values(InvoiceStatus))
const INVOICE_INCLUDE = { client: { select: { name: true } }, case: { select: { number: true, title: true } } } as const

type RouteContext = { params: Promise<{ id: string }> }

// Fetch-by-id so the edit modal never depends on the invoice being in the
// first page of the list.
export const GET = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:read:${auth.user.id}`, { limit: 600, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const invoice = await prisma.invoice.findFirst({ where: invoiceVisibilityWhere(auth.user, { id }), include: INVOICE_INCLUDE })
  if (!invoice) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  return jsonWithMoney(invoice)
})

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
  const v = validateFields(body, INVOICE_FIELDS)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const existing = await prisma.invoice.findFirst({
    where: invoiceVisibilityWhere(auth.user, { id }),
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Prisma.InvoiceUpdateInput = {}
  let nextAmount = existing.amount
  let nextPaid = existing.paid

  if (body.amount !== undefined) {
    const amount = parseMoney(body.amount)
    if (!amount || amount.lte(0)) return NextResponse.json({ error: 'مبلغ الفاتورة غير صالح (ثلاث منازل عشرية كحد أقصى)' }, { status: 400 })
    nextAmount = amount
  }
  if (body.paid !== undefined) {
    const paid = parseMoney(body.paid)
    if (!paid) return NextResponse.json({ error: 'المبلغ المدفوع غير صالح (ثلاث منازل عشرية كحد أقصى)' }, { status: 400 })
    nextPaid = paid
  }
  if (typeof body.status === 'string' && !INVOICE_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'حالة الفاتورة غير صالحة' }, { status: 400 })
  }

  const moneyTouched = body.amount !== undefined || body.paid !== undefined || typeof body.status === 'string'
  if (moneyTouched) {
    const correction = paymentCorrectionGuard(existing, { amount: nextAmount, paid: nextPaid }, isOfficeManager(auth.user))
    if (!correction.allowed) {
      await auditLog(req, auth.user, 'invoice.update_blocked', {
        entityType: 'invoice', entityId: existing.id,
        metadata: { reason: correction.reason, amount: existing.amount.toFixed(3), paid: existing.paid.toFixed(3) },
      })
      return NextResponse.json(
        { error: 'تخفيض مبلغ أو دفعة مسجّلة على فاتورة مدفوعة يقتصر على مدير المكتب', code: correction.reason },
        { status: 403 }
      )
    }
    const status = resolveInvoiceStatus(nextAmount, nextPaid, typeof body.status === 'string' ? body.status as InvoiceStatus : existing.status)
    if (!status.ok) return NextResponse.json({ error: status.error }, { status: 400 })
    data.amount = nextAmount
    data.paid = nextPaid
    data.status = status.status
    // First recorded payment is stamped once and never cleared.
    if (!existing.paymentRecordedAt && (nextPaid.gt(0) || status.status === 'PAID')) data.paymentRecordedAt = new Date()
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
  if ('notes' in body) data.notes = v.values.notes ?? null

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  // Conditional write: applies only if the money fields are still what we
  // validated against. A concurrent edit (or delete) in between makes this
  // match zero rows -> 409 instead of silently overwriting it.
  const { count } = await prisma.invoice.updateMany({
    where: { id: existing.id, amount: existing.amount, paid: existing.paid, status: existing.status },
    data: data as Prisma.InvoiceUpdateManyMutationInput,
  })
  if (count === 0) {
    return NextResponse.json({ error: 'تم تعديل الفاتورة أو حذفها للتو — أعد تحميلها وحاول مجدداً', code: 'write_conflict' }, { status: 409 })
  }
  const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: existing.id }, include: INVOICE_INCLUDE })

  const lowered = updated.paid.lt(existing.paid) || updated.amount.lt(existing.amount)
  await auditLog(req, auth.user, lowered ? 'invoice.payment_corrected' : 'invoice.updated', {
    entityType: 'invoice',
    entityId: updated.id,
    metadata: {
      fields: Object.keys(data),
      ...(moneyTouched ? {
        before: { amount: existing.amount.toFixed(3), paid: existing.paid.toFixed(3), status: existing.status },
        after: { amount: updated.amount.toFixed(3), paid: updated.paid.toFixed(3), status: updated.status },
      } : {}),
    },
  })
  return jsonWithMoney(updated)
})

export const DELETE = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const existing = await prisma.invoice.findFirst({
    where: invoiceVisibilityWhere(auth.user, { id }),
    select: { id: true, paid: true, status: true, paymentRecordedAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const blocked = () => NextResponse.json(
    { error: 'لا يمكن حذف فاتورة سُجّلت عليها دفعة. عدّل حالتها أو راجع مدير المكتب.', code: 'has_payment' },
    { status: 409 }
  )

  const guard = invoiceDeletionGuard(existing)
  if (!guard.allowed) {
    await auditLog(req, auth.user, 'invoice.delete_blocked', {
      entityType: 'invoice',
      entityId: existing.id,
      metadata: { reason: guard.reason, paid: existing.paid.toFixed(3), status: existing.status },
    })
    return blocked()
  }

  // Atomic check-and-delete: the guard's conditions are re-asserted in the
  // DELETE itself, so a payment recorded concurrently (between the read
  // above and this statement) makes it match nothing instead of deleting a
  // now-paid invoice.
  const { count } = await prisma.invoice.deleteMany({
    where: { id: existing.id, paymentRecordedAt: null, paid: 0, status: { not: 'PAID' } },
  })
  if (count === 0) {
    const stillThere = await prisma.invoice.findUnique({ where: { id: existing.id }, select: { id: true } })
    if (!stillThere) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
    await auditLog(req, auth.user, 'invoice.delete_blocked', { entityType: 'invoice', entityId: existing.id, metadata: { reason: 'payment_recorded_concurrently' } })
    return blocked()
  }
  await auditLog(req, auth.user, 'invoice.deleted', { entityType: 'invoice', entityId: existing.id })
  return NextResponse.json({ ok: true })
})
