import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { clientVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

const DEFAULT_LIMIT = 200

export async function GET(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const q = req.nextUrl.searchParams.get('q')?.trim()
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
}

export async function POST(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `clients:create:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'اسم العميل مطلوب' }, { status: 400 })
  }

  const client = await prisma.client.create({
    data: {
      name: body.name.trim(),
      phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      email: typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null,
      idNumber: typeof body.idNumber === 'string' && body.idNumber.trim() ? body.idNumber.trim() : null,
      address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null,
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
}
