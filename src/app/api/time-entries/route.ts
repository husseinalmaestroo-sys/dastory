import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { caseVisibilityWhere, timeEntryVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const entries = await prisma.timeEntry.findMany({
    where: timeEntryVisibilityWhere(auth.user),
    include: { case: { select: { number: true, title: true } }, user: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 200,
  })
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `timelog:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const minutes = Number(body?.minutes)
  if (!body || typeof body.task !== 'string' || !body.task.trim() || !Number.isFinite(minutes) || minutes <= 0) {
    return NextResponse.json({ error: 'وصف المهمة والمدة مطلوبان' }, { status: 400 })
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
}
