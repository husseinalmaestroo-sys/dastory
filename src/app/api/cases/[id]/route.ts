import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { CaseStatus } from '@prisma/client'
import { caseVisibilityWhere, clientWritableWhere, documentVisibilityWhere, isOfficeManager, sessionVisibilityWhere, staffWritableWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'

const CASE_STATUSES = new Set<string>(Object.values(CaseStatus))

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `cases:update:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params

  const c = await prisma.case.findFirst({
    where: caseVisibilityWhere(auth.user, { id }),
    include: {
      client: { select: { id: true, name: true, phone: true, email: true } },
      lawyer: { select: { id: true, name: true } },
      sessions: {
        where: sessionVisibilityWhere(auth.user),
        select: { id: true, date: true, time: true, court: true, judge: true, status: true, notes: true },
        orderBy: { date: 'asc' },
      },
      documents: {
        where: documentVisibilityWhere(auth.user),
        select: { id: true, name: true, type: true, size: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!c) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  return NextResponse.json(c)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `cases:delete:${auth.user.id}`, { limit: 60, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })

  const existing = await prisma.case.findFirst({
    where: caseVisibilityWhere(auth.user, { id }),
    select: { id: true, lawyerId: true, number: true, title: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.number === 'string') {
    if (!body.number.trim()) return NextResponse.json({ error: 'رقم القضية مطلوب' }, { status: 400 })
    data.number = body.number.trim()
  }
  if (typeof body.title === 'string') {
    if (!body.title.trim()) return NextResponse.json({ error: 'عنوان القضية مطلوب' }, { status: 400 })
    data.title = body.title.trim()
  }
  if (typeof body.type === 'string') {
    if (!body.type.trim()) return NextResponse.json({ error: 'نوع القضية مطلوب' }, { status: 400 })
    data.type = body.type.trim()
  }
  if ('court' in body) data.court = typeof body.court === 'string' && body.court.trim() ? body.court.trim() : null
  if ('notes' in body) data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
  if (typeof body.status === 'string') {
    if (!CASE_STATUSES.has(body.status)) return NextResponse.json({ error: 'حالة القضية غير صالحة' }, { status: 400 })
    data.status = body.status
  }
  if (typeof body.clientId === 'string' && body.clientId.trim()) {
    const client = await prisma.client.findFirst({
      where: clientWritableWhere(auth.user, { id: body.clientId, active: true }),
      select: { id: true },
    })
    if (!client) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 400 })
    data.clientId = client.id
  }
  if (isOfficeManager(auth.user) && 'lawyerId' in body) {
    if (typeof body.lawyerId === 'string' && body.lawyerId.trim()) {
      const lawyer = await prisma.user.findFirst({
        where: staffWritableWhere(auth.user, { id: body.lawyerId, active: true }),
        select: { id: true },
      })
      if (!lawyer) return NextResponse.json({ error: 'المحامي غير موجود' }, { status: 400 })
      data.lawyerId = lawyer.id
      data.ownerId = lawyer.id
    } else {
      data.lawyerId = null
      data.ownerId = auth.user.id
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'لا توجد تغييرات للحفظ' }, { status: 400 })
  }

  const updated = await prisma.case.update({
    where: { id: existing.id },
    data,
    include: { client: { select: { name: true } }, lawyer: { select: { name: true } } },
  })
  await auditLog(req, auth.user, 'case.updated', {
    entityType: 'case',
    entityId: updated.id,
    metadata: { fields: Object.keys(data) },
  })
  if (typeof data.lawyerId === 'string' && data.lawyerId !== existing.lawyerId && data.lawyerId !== auth.user.id) {
    await notifyUser(data.lawyerId, auth.user.officeId, 'تم تعيينك على قضية', `تم تعيينك على قضية ${existing.number} — ${existing.title}`)
  }
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await prisma.case.findFirst({
    where: caseVisibilityWhere(auth.user, { id }),
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  await prisma.$transaction([
    prisma.document.deleteMany({ where: { caseId: existing.id } }),
    prisma.session.deleteMany({ where: { caseId: existing.id } }),
    prisma.invoice.deleteMany({ where: { caseId: existing.id } }),
    prisma.case.delete({ where: { id: existing.id } }),
  ])

  await auditLog(req, auth.user, 'case.deleted', {
    entityType: 'case',
    entityId: existing.id,
  })
  return NextResponse.json({ ok: true })
}
