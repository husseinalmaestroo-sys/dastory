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

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    }),
    cursor ? Promise.resolve(undefined) : prisma.notification.count({ where: { userId: user.id } }),
    cursor ? Promise.resolve(undefined) : prisma.notification.count({ where: { userId: user.id, read: false } }),
  ])

  const result = buildPage(rows, limit, (r) => r.createdAt)
  const headers = paginationHeaders(result, total)
  if (unread !== undefined) headers['X-Unread-Count'] = String(unread)
  return NextResponse.json(result.page, { headers })
})

export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const user = auth.user
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } })
  return NextResponse.json({ ok: true })
})
