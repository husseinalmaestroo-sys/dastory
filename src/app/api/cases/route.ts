import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { CaseStatus } from '@prisma/client'
import { caseVisibilityWhere, clientWritableWhere, isOfficeManager, staffWritableWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { notifyUser } from '@/lib/notify'

const CASE_STATUSES = new Set<string>(Object.values(CaseStatus))

const LIST_CAP = 200

export async function GET(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const q = req.nextUrl.searchParams.get('q')?.trim()
  const extra = q
    ? { OR: [{ number: { contains: q } }, { title: { contains: q } }, { type: { contains: q } }, { client: { is: { name: { contains: q } } } }] }
    : {}

  const where = caseVisibilityWhere(auth.user, extra)
  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        client: { select: { name: true } },
        lawyer: { select: { name: true } },
        _count: { select: { sessions: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_CAP,
    }),
    prisma.case.count({ where }),
  ])
  return NextResponse.json(cases, { headers: { 'X-Total-Count': String(total) } })
}

export async function POST(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `cases:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (
    !body ||
    typeof body.number !== 'string' ||
    typeof body.title !== 'string' ||
    typeof body.type !== 'string' ||
    typeof body.clientId !== 'string' ||
    !body.number.trim() ||
    !body.title.trim() ||
    !body.type.trim() ||
    !body.clientId.trim()
  ) {
    return NextResponse.json({ error: 'بيانات القضية المطلوبة ناقصة' }, { status: 400 })
  }

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
      number: body.number.trim(),
      title: body.title.trim(),
      type: body.type.trim(),
      court: typeof body.court === 'string' && body.court.trim() ? body.court.trim() : null,
      status,
      clientId: client.id,
      lawyerId,
      ownerId,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
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
}
