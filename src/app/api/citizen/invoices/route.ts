import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

const DEFAULT_LIMIT = 200

export async function GET(req: NextRequest) {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    { clientId: auth.user.clientId, officeId: auth.user.officeId },
    cursorWhereClause('createdAt', 'desc', cursor)
  ) as Prisma.InvoiceWhereInput

  const rows = await prisma.invoice.findMany({
    where,
    include: {
      case: { select: { number: true, title: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
}
