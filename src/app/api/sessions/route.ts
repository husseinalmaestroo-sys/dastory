import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { SessionStatus } from '@prisma/client'
import { caseVisibilityWhere, sessionVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parseDateRange, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withIdempotency } from '@/lib/idempotency'
import { withErrorHandling } from '@/lib/api-handler'
import { validateFields } from '@/lib/validation'
import { SESSION_FIELDS, required } from '@/lib/field-specs'

const SESSION_FIELDS_CREATE = required(SESSION_FIELDS, 'time', 'court')

const SESSION_STATUSES = new Set<string>(Object.values(SessionStatus))
const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params
  const range = parseDateRange(req, 'date')
  if (!range.ok) return range.response
  // Ascending (default; upcoming first when combined with from=now) or
  // descending (most recent past sessions first, with to=now).
  const order = req.nextUrl.searchParams.get('order') === 'desc' ? 'desc' : 'asc'

  const where = combineWhere(
    sessionVisibilityWhere(auth.user, range.where as Prisma.SessionWhereInput),
    cursorWhereClause('date', order, cursor)
  ) as Prisma.SessionWhereInput

  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      include: { case: { include: { client: { select: { name: true } } } } },
      orderBy: [{ date: order }, { id: order }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.session.count({ where: sessionVisibilityWhere(auth.user, range.where as Prisma.SessionWhereInput) }),
  ])

  const result = buildPage(rows, limit, (r) => r.date)
  return NextResponse.json(result.page, { headers: paginationHeaders(result, total) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `sessions:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  return withIdempotency(req, auth.user.id, 'sessions:create', async () => {
    const body = await req.json().catch(() => null)
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.caseId !== 'string' ||
      typeof body.date !== 'string' ||
      !body.caseId.trim() ||
      !body.date.trim()
    ) {
      return { status: 400, body: { error: 'بيانات الجلسة المطلوبة ناقصة' } }
    }
    const v = validateFields(body, SESSION_FIELDS_CREATE)
    if (!v.ok) return { status: 400, body: { error: v.error } }

    const date = new Date(body.date)
    if (Number.isNaN(date.getTime())) {
      return { status: 400, body: { error: 'تاريخ الجلسة غير صالح' } }
    }

    const caseRow = await prisma.case.findFirst({
      where: caseVisibilityWhere(auth.user, { id: body.caseId }),
      select: { id: true, number: true, ownerId: true },
    })
    if (!caseRow) return { status: 400, body: { error: 'القضية غير موجودة' } }

    const status = typeof body.status === 'string' && SESSION_STATUSES.has(body.status)
      ? body.status as SessionStatus
      : undefined

    const s = await prisma.session.create({
      data: {
        caseId: caseRow.id,
        date,
        time: v.values.time as string,
        court: v.values.court as string,
        judge: v.values.judge ?? null,
        status,
        notes: v.values.notes ?? null,
        officeId: auth.user.officeId,
      },
      include: { case: { include: { client: { select: { name: true } } } } },
    })
    await auditLog(req, auth.user, 'session.created', {
      entityType: 'session',
      entityId: s.id,
      metadata: { caseId: caseRow.id, status: s.status },
    })
    if (caseRow.ownerId !== auth.user.id) {
      await notifyUser(caseRow.ownerId, auth.user.officeId, 'جلسة جديدة', `تمت إضافة جلسة بتاريخ ${s.date.toLocaleDateString('ar-JO')} لقضية ${caseRow.number}`)
    }
    return { status: 201, body: s }
  })
})
