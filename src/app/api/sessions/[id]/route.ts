import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { SessionStatus } from '@prisma/client'
import { sessionVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'
import { withErrorHandling } from '@/lib/api-handler'
import { validateFields } from '@/lib/validation'
import { SESSION_FIELDS } from '@/lib/field-specs'

const SESSION_STATUSES = new Set<string>(Object.values(SessionStatus))

// Fetch-by-id so the edit modal never depends on the session being in the
// first page of the list.
export const GET = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `sessions:read:${auth.user.id}`, { limit: 600, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const session = await prisma.session.findFirst({
    where: sessionVisibilityWhere(auth.user, { id }),
    include: { case: { select: { id: true, number: true, title: true, client: { select: { name: true } } } } },
  })
  if (!session) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  return NextResponse.json(session)
})

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `sessions:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
  const v = validateFields(body, SESSION_FIELDS)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

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
  if ('time' in body) {
    if (!v.values.time) return NextResponse.json({ error: 'وقت الجلسة مطلوب' }, { status: 400 })
    data.time = v.values.time
  }
  if ('court' in body) {
    if (!v.values.court) return NextResponse.json({ error: 'المحكمة مطلوبة' }, { status: 400 })
    data.court = v.values.court
  }
  if ('judge' in body) data.judge = v.values.judge ?? null
  if ('notes' in body) data.notes = v.values.notes ?? null
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
  const limited = rateLimit(req, `sessions:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

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
