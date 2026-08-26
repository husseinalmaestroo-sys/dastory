import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { InvoiceStatus } from '@prisma/client'
import { caseVisibilityWhere, clientWritableWhere, invoiceVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

const INVOICE_STATUSES = new Set<string>(Object.values(InvoiceStatus))
const DEFAULT_LIMIT = 200

export async function GET(req: NextRequest) {
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
  return NextResponse.json(result.page, { headers: paginationHeaders(result, total) })
}

export async function POST(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `invoices:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const amount = Number(body?.amount)
  const paid = Number(body?.paid ?? 0)
  if (
    !body ||
    typeof body.number !== 'string' ||
    typeof body.clientId !== 'string' ||
    !body.number.trim() ||
    !body.clientId.trim() ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(paid) ||
    paid < 0
  ) {
    return NextResponse.json({ error: 'بيانات الفاتورة المطلوبة غير صالحة' }, { status: 400 })
  }
  if (paid > amount) {
    return NextResponse.json({ error: 'المبلغ المدفوع لا يمكن أن يتجاوز مبلغ الفاتورة' }, { status: 400 })
  }

  const client = await prisma.client.findFirst({
    where: clientWritableWhere(auth.user, { id: body.clientId, active: true }),
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 400 })

  let caseId: string | null = null
  if (typeof body.caseId === 'string' && body.caseId.trim()) {
    const caseRow = await prisma.case.findFirst({
      where: caseVisibilityWhere(auth.user, { id: body.caseId, clientId: client.id }),
      select: { id: true },
    })
    if (!caseRow) return NextResponse.json({ error: 'القضية غير موجودة لهذا العميل' }, { status: 400 })
    caseId = caseRow.id
  }

  let dueDate: Date | undefined
  if (typeof body.dueDate === 'string' && body.dueDate.trim()) {
    dueDate = new Date(body.dueDate)
    if (Number.isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: 'تاريخ الاستحقاق غير صالح' }, { status: 400 })
    }
  }

  const status = typeof body.status === 'string' && INVOICE_STATUSES.has(body.status)
    ? body.status as InvoiceStatus
    : undefined

  const inv = await prisma.invoice.create({
    data: {
      number: body.number.trim(),
      amount,
      paid,
      status,
      dueDate,
      clientId: client.id,
      caseId,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      officeId: auth.user.officeId,
    },
    include: { client: { select: { name: true } } },
  })
  await auditLog(req, auth.user, 'invoice.created', {
    entityType: 'invoice',
    entityId: inv.id,
    metadata: { clientId: client.id, caseId, status: inv.status },
  })
  return NextResponse.json(inv, { status: 201 })
}
