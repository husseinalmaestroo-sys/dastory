import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'

export async function GET(req: NextRequest) {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `audit-logs:list:${auth.user.id}`, { limit: 120, windowMs: 60 * 60_000 })
  if (limited) return limited

  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50

  const logs = await prisma.auditLog.findMany({
    where: { officeId: auth.user.officeId },
    orderBy: { createdAt: 'desc' },
    take: limit,
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

  return NextResponse.json(logs)
}
