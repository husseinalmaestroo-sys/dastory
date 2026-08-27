import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { isOfficeManager } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withIdempotency } from '@/lib/idempotency'
import { withErrorHandling } from '@/lib/api-handler'

const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    { officeId: auth.user.officeId },
    cursorWhereClause('date', 'asc', cursor)
  ) as Prisma.CalendarEventWhereInput

  const rows = await prisma.calendarEvent.findMany({
    where,
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.date)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `calendar:create:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  return withIdempotency(req, auth.user.id, 'calendar-events:create', async () => {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.title !== 'string' || !body.title.trim() || typeof body.date !== 'string') {
      return { status: 400, body: { error: 'عنوان الحدث وتاريخه مطلوبان' } }
    }
    const date = new Date(body.date)
    if (Number.isNaN(date.getTime())) return { status: 400, body: { error: 'تاريخ غير صالح' } }

    const event = await prisma.calendarEvent.create({
      data: {
        title: body.title.trim().slice(0, 200),
        date,
        type: typeof body.type === 'string' && body.type.trim() ? body.type.trim().slice(0, 40) : 'general',
        officeId: auth.user.officeId,
        createdById: auth.user.id,
      },
    })
    await auditLog(req, auth.user, 'calendar.event_created', { entityType: 'calendar_event', entityId: event.id })
    return { status: 201, body: event }
  })
})

export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'معرّف الحدث مطلوب' }, { status: 400 })

  const event = await prisma.calendarEvent.findFirst({ where: { id, officeId: auth.user.officeId } })
  if (!event) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  if (!isOfficeManager(auth.user) && event.createdById !== auth.user.id) {
    return NextResponse.json({ error: 'لا تملك صلاحية حذف هذا الحدث' }, { status: 403 })
  }

  await prisma.calendarEvent.delete({ where: { id: event.id } })
  await auditLog(req, auth.user, 'calendar.event_deleted', { entityType: 'calendar_event', entityId: event.id })
  return NextResponse.json({ ok: true })
})
