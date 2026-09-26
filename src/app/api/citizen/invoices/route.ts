import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'
import { CITIZEN_INVOICE_SELECT } from '@/lib/citizen-fields'
import { jsonWithMoney } from '@/lib/money'

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
  ) as Prisma.InvoiceWhereInput

  const rows = await prisma.invoice.findMany({
    where,
    // Explicit allow-list — never invoice notes (citizen-fields.ts).
    select: CITIZEN_INVOICE_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return jsonWithMoney(result.page, { headers: paginationHeaders(result) })
})
