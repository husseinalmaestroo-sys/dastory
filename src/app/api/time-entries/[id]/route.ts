import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { timeEntryVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { timeEntryDeletionGuard } from '@/lib/financial-guards'
import { withErrorHandling } from '@/lib/api-handler'
import { validateFields } from '@/lib/validation'
import { TIME_ENTRY_FIELDS } from '@/lib/field-specs'

// Matches the cap in ../route.ts POST — see the comment there.
const MAX_MINUTES_PER_ENTRY = 100_000

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `timelog:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
  const v = validateFields(body, TIME_ENTRY_FIELDS)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const existing = await prisma.timeEntry.findFirst({ where: timeEntryVisibilityWhere(auth.user, { id }), select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if ('task' in body) {
    if (!v.values.task) return NextResponse.json({ error: 'وصف المهمة مطلوب' }, { status: 400 })
    data.task = v.values.task
  }
  if (body.minutes !== undefined) {
    const minutes = Number(body.minutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return NextResponse.json({ error: 'المدة غير صالحة' }, { status: 400 })
    if (minutes > MAX_MINUTES_PER_ENTRY) return NextResponse.json({ error: 'المدة أكبر من المسموح لتسجيل وقت واحد' }, { status: 400 })
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
})

export const DELETE = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `timelog:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

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
})
