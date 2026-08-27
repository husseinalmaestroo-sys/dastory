import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { buildPage, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'

const DEFAULT_LIMIT = 200

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = documentVisibilityWhere(auth.user, cursorWhereClause('createdAt', 'desc', cursor) as Prisma.DocumentWhereInput)

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { case: { select: { number: true, title: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.document.count({ where: documentVisibilityWhere(auth.user) }),
  ])

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(
    result.page.map((doc) => ({ ...doc, url: `/api/documents/${doc.id}/download` })),
    { headers: paginationHeaders(result, total) }
  )
})
