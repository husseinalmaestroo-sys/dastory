import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCitizenUser } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
  const auth = await requireCitizenUser(req)
  if (!auth.ok) return auth.response

  const invoices = await prisma.invoice.findMany({
    where: { clientId: auth.user.clientId, officeId: auth.user.officeId },
    include: {
      case: { select: { number: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(invoices)
}
