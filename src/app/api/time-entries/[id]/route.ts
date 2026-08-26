import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { timeEntryVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { timeEntryDeletionGuard } from '@/lib/financial-guards'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `timelog:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const existing = await prisma.timeEntry.findFirst({ where: timeEntryVisibilityWhere(auth.user, { id }), select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.task === 'string') {
    if (!body.task.trim()) return NextResponse.json({ error: 'وصف المهمة مطلوب' }, { status: 400 })
    data.task = body.task.trim().slice(0, 200)
  }
  if (body.minutes !== undefined) {
    const minutes = Number(body.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return NextResponse.json({ error: 'المدة غير صالحة' }, { status: 400 })
    data.minutes = Math.round(minutes)
  }
  if (typeof body.billable === 'boolean') data.billable = body.billable
  if (typeof body.invoiced === 'boolean') data.invoiced = body.invoiced

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })

  const updated = await prisma.timeEntry.update({
    where: { id: existing.id },
    data,
    include: { case: { select: { number: true, title: true } }, user: { select: { name: true } } },
  })
  await auditLog(req, auth.user, 'timelog.updated', { entityType: 'time_entry', entityId: updated.id, metadata: { fields: Object.keys(data) } })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await prisma.timeEntry.findFirst({ where: timeEntryVisibilityWhere(auth.user, { id }), select: { id: true, invoiced: true } })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const guard = timeEntryDeletionGuard(existing)
  if (!guard.allowed) {
    await auditLog(req, auth.user, 'timelog.delete_blocked', { entityType: 'time_entry', entityId: existing.id, metadata: { reason: guard.reason } })
    return NextResponse.json(
      { error: 'لا يمكن حذف تسجيل وقت مُفوتَر مسبقاً. أزل علامة الفوترة أولاً إذا لزم.' },
      { status: 409 }
    )
  }

  await prisma.timeEntry.delete({ where: { id: existing.id } })
  await auditLog(req, auth.user, 'timelog.deleted', { entityType: 'time_entry', entityId: existing.id })
  return NextResponse.json({ ok: true })
}
