import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { isOfficeManager } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const events = await prisma.calendarEvent.findMany({
    where: { officeId: auth.user.officeId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { date: 'asc' },
  })
  return NextResponse.json(events)
}

export async function POST(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `calendar:create:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body.title !== 'string' || !body.title.trim() || typeof body.date !== 'string') {
    return NextResponse.json({ error: 'عنوان الحدث وتاريخه مطلوبان' }, { status: 400 })
  }
  const date = new Date(body.date)
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 })

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
  return NextResponse.json(event, { status: 201 })
}

export async function DELETE(req: NextRequest) {
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
}
