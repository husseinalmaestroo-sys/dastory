import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser } from '@/lib/auth-server'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'
import { withErrorHandling } from '@/lib/api-handler'

const DEFAULT_LIMIT = 20

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const user = auth.user

  const pagination = parsePagination(req, DEFAULT_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    { userId: user.id },
    cursorWhereClause('createdAt', 'desc', cursor)
  ) as Prisma.NotificationWhereInput

  const rows = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
})

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const user = auth.user
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } })
  return NextResponse.json({ ok: true })
})
