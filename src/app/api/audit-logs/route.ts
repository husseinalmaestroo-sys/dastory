import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { buildPage, combineWhere, cursorWhereClause, paginationHeaders, parsePagination } from '@/lib/pagination'
import type { Prisma } from '@prisma/client'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export async function GET(req: NextRequest) {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `audit-logs:list:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const pagination = parsePagination(req, DEFAULT_LIMIT, MAX_LIMIT)
  if (!pagination.ok) return pagination.response
  const { limit, cursor } = pagination.params

  const where = combineWhere(
    { officeId: auth.user.officeId },
    cursorWhereClause('createdAt', 'desc', cursor)
  ) as Prisma.AuditLogWhereInput

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      action: true,
      actorEmail: true,
      actorRole: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      userAgent: true,
      metadata: true,
      createdAt: true,
    },
  })

  const result = buildPage(rows, limit, (r) => r.createdAt)
  return NextResponse.json(result.page, { headers: paginationHeaders(result) })
}
