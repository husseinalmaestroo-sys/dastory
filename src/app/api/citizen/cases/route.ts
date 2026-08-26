import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const cases = await prisma.case.findMany({
    where: { clientId: auth.user.clientId, officeId: auth.user.officeId },
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
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(cases)
}
