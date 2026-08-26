import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const sessions = await prisma.session.findMany({
    where: {
      officeId: auth.user.officeId,
      case: { clientId: auth.user.clientId, officeId: auth.user.officeId },
    },
    include: {
      case: { select: { number: true, title: true } },
    },
    orderBy: { date: 'asc' },
  })

  return NextResponse.json(sessions)
}
