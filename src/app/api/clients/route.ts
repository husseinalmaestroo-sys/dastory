import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { clientVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'
import { isValidEmail, validateFields } from '@/lib/validation'
import { CLIENT_FIELDS, required } from '@/lib/field-specs'

const DEFAULT_LIMIT = 200

const CLIENT_FIELDS_CREATE = required(CLIENT_FIELDS, 'name')

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 120)
  const searchExtra = q
    ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }, { idNumber: { contains: q } }] }
    : {}
  const activeExtra = { active: true }

  const where = clientVisibilityWhere(
    auth.user,
    combineWhere(activeExtra, searchExtra, cursorWhereClause('createdAt', 'desc', cursor)) as Prisma.ClientWhereInput
  )

  const [rows, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: { _count: { select: { cases: true, invoices: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.client.count({ where: clientVisibilityWhere(auth.user, combineWhere(activeExtra, searchExtra) as Prisma.ClientWhereInput) }),
  ])

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result, total) })
})

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'اسم العميل مطلوب' }, { status: 400 })
  const v = validateFields(body, CLIENT_FIELDS_CREATE)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  if (v.values.email && !isValidEmail(v.values.email)) {
    return NextResponse.json({ error: 'البريد الإلكتروني غير صحيح' }, { status: 400 })
  }

  const client = await prisma.client.create({
    data: {
      name: v.values.name as string,
      phone: v.values.phone ?? null,
      email: v.values.email ? v.values.email.toLowerCase() : null,
      idNumber: v.values.idNumber ?? null,
      address: v.values.address ?? null,
      officeId: auth.user.officeId,
      ownerId: auth.user.id,
    },
  })
  await auditLog(req, auth.user, 'client.created', {
    entityType: 'client',
    entityId: client.id,
    metadata: { hasEmail: Boolean(client.email), hasPhone: Boolean(client.phone) },
  })
  return NextResponse.json(client, { status: 201 })
})
