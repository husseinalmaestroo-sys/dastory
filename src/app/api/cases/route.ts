import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { CaseStatus } from '@prisma/client'
import { caseVisibilityWhere, clientWritableWhere, isOfficeManager, staffWritableWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'
import { validateFields } from '@/lib/validation'
import { CASE_FIELDS, required } from '@/lib/field-specs'

const CASE_FIELDS_CREATE = required(CASE_FIELDS, 'number', 'title', 'type')

const CASE_STATUSES = new Set<string>(Object.values(CaseStatus))

const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 120)
  const statusParam = req.nextUrl.searchParams.get('status')
  if (statusParam && !CASE_STATUSES.has(statusParam)) {
    return NextResponse.json({ error: 'حالة القضية غير صالحة' }, { status: 400 })
  }
  const searchExtra = combineWhere(
    q ? { OR: [{ number: { contains: q } }, { title: { contains: q } }, { type: { contains: q } }, { client: { is: { name: { contains: q } } } }] } : {},
    statusParam ? { status: statusParam } : {}
  ) as Prisma.CaseWhereInput

  const where = caseVisibilityWhere(auth.user, combineWhere(searchExtra, cursorWhereClause('createdAt', 'desc', cursor)) as Prisma.CaseWhereInput)

  const [rows, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        client: { select: { name: true } },
        lawyer: { select: { name: true } },
        _count: { select: { sessions: true, documents: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.case.count({ where: caseVisibilityWhere(auth.user, searchExtra) }),
  ])

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result, total) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `cases:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.clientId !== 'string' || !body.clientId.trim()) {
    return NextResponse.json({ error: 'بيانات القضية المطلوبة ناقصة' }, { status: 400 })
  }
  const v = validateFields(body, CASE_FIELDS_CREATE)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const client = await prisma.client.findFirst({
    where: clientWritableWhere(auth.user, { id: body.clientId, active: true }),
    select: { id: true, ownerId: true },
  })
  if (!client) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 400 })

  let ownerId = auth.user.id
  let lawyerId: string | null = auth.user.id
  if (isOfficeManager(auth.user) && typeof body.lawyerId === 'string' && body.lawyerId.trim()) {
    const lawyer = await prisma.user.findFirst({
      where: staffWritableWhere(auth.user, { id: body.lawyerId, active: true }),
      select: { id: true },
    })
    if (!lawyer) return NextResponse.json({ error: 'المحامي غير موجود' }, { status: 400 })
    ownerId = lawyer.id
    lawyerId = lawyer.id
  } else if (isOfficeManager(auth.user)) {
    lawyerId = null
  }

  const status = typeof body.status === 'string' && CASE_STATUSES.has(body.status)
    ? body.status as CaseStatus
    : undefined

  const c = await prisma.case.create({
    data: {
      number: v.values.number as string,
      title: v.values.title as string,
      type: v.values.type as string,
      court: v.values.court ?? null,
      status,
      clientId: client.id,
      lawyerId,
      ownerId,
      notes: v.values.notes ?? null,
      officeId: auth.user.officeId,
    },
    include: { client: { select: { name: true } } },
  })
  await auditLog(req, auth.user, 'case.created', {
    entityType: 'case',
    entityId: c.id,
    metadata: { status: c.status, hasAssignedLawyer: Boolean(c.lawyerId) },
  })
  if (c.lawyerId && c.lawyerId !== auth.user.id) {
    await notifyUser(c.lawyerId, auth.user.officeId, 'قضية جديدة موكلة إليك', `تم تعيينك على قضية ${c.number} — ${c.title}`)
  }
  return NextResponse.json(c, { status: 201 })
})
