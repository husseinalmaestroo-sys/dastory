import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { InvoiceStatus, Prisma } from '@prisma/client'
import { caseVisibilityWhere, clientWritableWhere, invoiceVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import { withIdempotency } from '@/lib/idempotency'
import { withErrorHandling } from '@/lib/api-handler'
import { decimalsToNumbers, jsonWithMoney, parseMoney } from '@/lib/money'
import { resolveInvoiceStatus } from '@/lib/financial-guards'
import { validateFields } from '@/lib/validation'
import { INVOICE_FIELDS, required } from '@/lib/field-specs'

const INVOICE_STATUSES = new Set<string>(Object.values(InvoiceStatus))
const DEFAULT_LIMIT = 200
const INVOICE_FIELDS_CREATE = required(INVOICE_FIELDS, 'number')

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = invoiceVisibilityWhere(auth.user, cursorWhereClause('createdAt', 'desc', cursor) as Prisma.InvoiceWhereInput)

  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: { select: { name: true } },
        case: { select: { number: true, title: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.invoice.count({ where: invoiceVisibilityWhere(auth.user) }),
  ])

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return jsonWithMoney(result.page, { headers: paginationHeaders(result, total) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  return withIdempotency(req, auth.user.id, 'invoices:create', async () => {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || typeof body.clientId !== 'string' || !body.clientId.trim()) {
      return { status: 400, body: { error: 'بيانات الفاتورة المطلوبة غير صالحة' } }
    }
    const v = validateFields(body, INVOICE_FIELDS_CREATE)
    if (!v.ok) return { status: 400, body: { error: v.error } }

    const amount = parseMoney(body.amount)
    const paid = body.paid === undefined || body.paid === null ? parseMoney(0) : parseMoney(body.paid)
    if (!amount || amount.lte(0) || !paid) {
      return { status: 400, body: { error: 'بيانات الفاتورة المطلوبة غير صالحة — المبالغ بثلاث منازل عشرية كحد أقصى' } }
    }
    const requestedStatus = typeof body.status === 'string' && INVOICE_STATUSES.has(body.status)
      ? body.status as InvoiceStatus
      : undefined
    const status = resolveInvoiceStatus(amount, paid, requestedStatus)
    if (!status.ok) return { status: 400, body: { error: status.error } }

    const client = await prisma.client.findFirst({
      where: clientWritableWhere(auth.user, { id: body.clientId, active: true }),
      select: { id: true },
    })
    if (!client) return { status: 400, body: { error: 'العميل غير موجود' } }

    let caseId: string | null = null
    if (typeof body.caseId === 'string' && body.caseId.trim()) {
      const caseRow = await prisma.case.findFirst({
        where: caseVisibilityWhere(auth.user, { id: body.caseId, clientId: client.id }),
        select: { id: true },
      })
      if (!caseRow) return { status: 400, body: { error: 'القضية غير موجودة لهذا العميل' } }
      caseId = caseRow.id
    }

    let dueDate: Date | undefined
    if (typeof body.dueDate === 'string' && body.dueDate.trim()) {
      dueDate = new Date(body.dueDate)
      if (Number.isNaN(dueDate.getTime())) {
        return { status: 400, body: { error: 'تاريخ الاستحقاق غير صالح' } }
      }
    }

    let inv
    try {
      inv = await prisma.invoice.create({
        data: {
          number: v.values.number as string,
          amount,
          paid,
          status: status.status,
          paymentRecordedAt: paid.gt(0) || status.status === 'PAID' ? new Date() : null,
          dueDate,
          clientId: client.id,
          caseId,
          notes: v.values.notes ?? null,
          officeId: auth.user.officeId,
        },
        include: { client: { select: { name: true } } },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { status: 409, body: { error: 'رقم الفاتورة مستخدم مسبقاً في هذا المكتب' } }
      }
      throw err
    }

    await auditLog(req, auth.user, 'invoice.created', {
      entityType: 'invoice',
      entityId: inv.id,
      metadata: { clientId: client.id, caseId, status: inv.status, amount: inv.amount.toFixed(3), paid: inv.paid.toFixed(3) },
    })
    // Converted here (not just at response time) because the idempotency
    // layer stores this body as JSON for replay.
    return { status: 201, body: decimalsToNumbers(inv) }
  })
})
