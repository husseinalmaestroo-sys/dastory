import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeManager } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
  try {
    const auth = await requireOfficeManager(req)
    if (!auth.ok) return auth.response
    const officeId = auth.user.officeId

    const [casesByStatus, casesByType, invoiceAgg, invoicesByStatus, team, sessionsThisMonth, totalClients] =
      await Promise.all([
        prisma.case.groupBy({ by: ['status'], where: { officeId }, _count: { _all: true } }),
        prisma.case.groupBy({
          by: ['type'],
          where: { officeId },
          _count: { _all: true },
          orderBy: { _count: { type: 'desc' } },
          take: 6,
        }),
        prisma.invoice.aggregate({
          where: { officeId },
          _sum: { amount: true, paid: true },
          _count: { _all: true },
        }),
        prisma.invoice.groupBy({
          by: ['status'],
          where: { officeId },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.user.findMany({
          where: { officeId, role: { in: ['LAWYER', 'OFFICE_MANAGER'] }, active: true },
          select: { id: true, name: true, role: true, _count: { select: { cases: true } } },
        }),
        prisma.session.count({
          where: {
            officeId,
            date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
        }),
        prisma.client.count({ where: { officeId } }),
      ])

    return NextResponse.json({
      casesByStatus,
      casesByType,
      totalRevenue: invoiceAgg._sum.amount ?? 0,
      totalPaid: invoiceAgg._sum.paid ?? 0,
      totalInvoices: invoiceAgg._count._all,
      invoicesByStatus,
      team,
      sessionsThisMonth,
      totalClients,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
  }
}
