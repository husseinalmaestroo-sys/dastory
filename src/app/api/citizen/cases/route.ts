import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'

const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    { clientId: auth.user.clientId, officeId: auth.user.officeId },
    cursorWhereClause('createdAt', 'desc', cursor)
  ) as Prisma.CaseWhereInput

  const rows = await prisma.case.findMany({
    where,
    include: {
      lawyer: { select: { name: true } },
      sessions: {
        where: { status: 'UPCOMING' },
        select: { id: true, date: true, time: true, court: true, status: true },
        orderBy: { date: 'asc' },
        take: 3,
      },
      _count: { select: { sessions: true, documents: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
})
