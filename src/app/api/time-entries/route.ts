import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { caseVisibilityWhere, timeEntryVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'

const DEFAULT_LIMIT = 200
// A single logged task realistically never exceeds a couple of months of
// minutes. Without an upper bound, MySQL (non-strict mode) silently clamps
// an out-of-INT-range value to 2147483647 instead of erroring — found while
// auditing error handling; this closes it at the validation layer instead.
const MAX_MINUTES_PER_ENTRY = 100_000

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = timeEntryVisibilityWhere(auth.user, cursorWhereClause('date', 'desc', cursor) as Prisma.TimeEntryWhereInput)

  const rows = await prisma.timeEntry.findMany({
    where,
    include: { case: { select: { number: true, title: true } }, user: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.date)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `timelog:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const minutes = Number(body?.minutes)
  if (!body || typeof body.task !== 'string' || !body.task.trim() || !Number.isFinite(minutes) || minutes <= 0) {
    return NextResponse.json({ error: 'وصف المهمة والمدة مطلوبان' }, { status: 400 })
  }
  if (minutes > MAX_MINUTES_PER_ENTRY) {
    return NextResponse.json({ error: 'المدة أكبر من المسموح لتسجيل وقت واحد' }, { status: 400 })
  }

  let caseId: string | null = null
  if (typeof body.caseId === 'string' && body.caseId.trim()) {
    const caseRow = await prisma.case.findFirst({ where: caseVisibilityWhere(auth.user, { id: body.caseId }), select: { id: true } })
    if (!caseRow) return NextResponse.json({ error: 'القضية غير موجودة' }, { status: 400 })
    caseId = caseRow.id
  }

  const date = typeof body.date === 'string' && body.date.trim() ? new Date(body.date) : new Date()
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 })

  const entry = await prisma.timeEntry.create({
    data: {
      task: body.task.trim().slice(0, 200),
      minutes: Math.round(minutes),
      billable: body.billable !== false,
      caseId,
      date,
      officeId: auth.user.officeId,
      userId: auth.user.id,
    },
    include: { case: { select: { number: true, title: true } }, user: { select: { name: true } } },
  })
  await auditLog(req, auth.user, 'timelog.created', { entityType: 'time_entry', entityId: entry.id, metadata: { minutes: entry.minutes, caseId } })
  return NextResponse.json(entry, { status: 201 })
})
