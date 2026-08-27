import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { SessionStatus } from '@prisma/client'
import { sessionVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'
import { withErrorHandling } from '@/lib/api-handler'

const SESSION_STATUSES = new Set<string>(Object.values(SessionStatus))

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `sessions:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const existing = await prisma.session.findFirst({
    where: sessionVisibilityWhere(auth.user, { id }),
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.date === 'string' && body.date.trim()) {
    const date = new Date(body.date)
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'تاريخ الجلسة غير صالح' }, { status: 400 })
    data.date = date
  }
  if (typeof body.time === 'string') {
    if (!body.time.trim()) return NextResponse.json({ error: 'وقت الجلسة مطلوب' }, { status: 400 })
    data.time = body.time.trim()
  }
  if (typeof body.court === 'string') {
    if (!body.court.trim()) return NextResponse.json({ error: 'المحكمة مطلوبة' }, { status: 400 })
    data.court = body.court.trim()
  }
  if ('judge' in body) data.judge = typeof body.judge === 'string' && body.judge.trim() ? body.judge.trim() : null
  if ('notes' in body) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  if (typeof body.status === 'string') {
    if (!SESSION_STATUSES.has(body.status)) return NextResponse.json({ error: 'حالة الجلسة غير صالحة' }, { status: 400 })
    data.status = body.status
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  const updated = await prisma.session.update({
    where: { id: existing.id },
    data,
    include: { case: { include: { client: { select: { name: true } } } } },
  })
  await auditLog(req, auth.user, 'session.updated', {
    entityType: 'session',
    entityId: updated.id,
    metadata: { fields: Object.keys(data) },
  })
  if (data.status === 'POSTPONED' && updated.case.ownerId !== auth.user.id) {
    await notifyUser(updated.case.ownerId, auth.user.officeId, 'تأجيل جلسة', `تم تأجيل جلسة قضية ${updated.case.number} إلى ${updated.date.toLocaleDateString('ar-JO')}`)
  }
  return NextResponse.json(updated)
})

export const DELETE = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await prisma.session.findFirst({
    where: sessionVisibilityWhere(auth.user, { id }),
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  await prisma.session.delete({ where: { id: existing.id } })
  await auditLog(req, auth.user, 'session.deleted', { entityType: 'session', entityId: existing.id })
  return NextResponse.json({ ok: true })
})
