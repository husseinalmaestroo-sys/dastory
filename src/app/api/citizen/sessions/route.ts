import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'
import { CITIZEN_SESSION_SELECT } from '@/lib/citizen-fields'

const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    {
      officeId: auth.user.officeId,
      case: { clientId: auth.user.clientId, officeId: auth.user.officeId },
    },
    cursorWhereClause('date', 'asc', cursor)
  ) as Prisma.SessionWhereInput

  const rows = await prisma.session.findMany({
    where,
    // Explicit allow-list — never session notes (citizen-fields.ts).
    select: CITIZEN_SESSION_SELECT,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.date)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
})
