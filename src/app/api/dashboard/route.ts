import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { caseVisibilityWhere, clientVisibilityWhere, invoiceVisibilityWhere, sessionVisibilityWhere } from '@/lib/tenant-scope'
import { withErrorHandling } from '@/lib/api-handler'

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const clientWhere = clientVisibilityWhere(auth.user, { active: true })
  const caseWhere = caseVisibilityWhere(auth.user)
  const activeCaseWhere = caseVisibilityWhere(auth.user, { status: 'ACTIVE' })
  const sessionWhere = sessionVisibilityWhere(auth.user, { status: 'UPCOMING', date: { gte: new Date() } })
  const invoiceWhere = invoiceVisibilityWhere(auth.user)
  const paidInvoiceWhere = invoiceVisibilityWhere(auth.user, { status: 'PAID' })
  const unpaidInvoiceWhere = invoiceVisibilityWhere(auth.user, { status: { in: ['UNPAID', 'OVERDUE', 'PARTIAL'] } })

  const [
    totalClients, totalCases, activeCases, upcomingSessions,
    totalInvoices, paidInvoices, unpaidAmount, recentCases, todaySessions,
  ] = await Promise.all([
    prisma.client.count({ where: clientWhere }),
    prisma.case.count({ where: caseWhere }),
    prisma.case.count({ where: activeCaseWhere }),
    prisma.session.count({ where: sessionWhere }),
    prisma.invoice.aggregate({ where: invoiceWhere, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: paidInvoiceWhere, _sum: { paid: true } }),
    prisma.invoice.aggregate({ where: unpaidInvoiceWhere, _sum: { amount: true } }),
    prisma.case.findMany({ where: caseWhere, orderBy: { createdAt: 'desc' }, take: 5, include: { client: { select: { name: true } } } }),
    prisma.session.findMany({
      where: sessionVisibilityWhere(auth.user, {
        status: 'UPCOMING',
        date: { gte: new Date(), lte: new Date(Date.now() + 86400000 * 2) },
      }),
      include: { case: { select: { number: true, title: true } } },
      orderBy: { date: 'asc' },
      take: 50,
    }),
  ])

  return NextResponse.json({
    stats: {
      totalClients,
      totalCases,
      activeCases,
      upcomingSessions,
      revenue: paidInvoices._sum.paid ?? 0,
      unpaid: unpaidAmount._sum.amount ?? 0,
      totalRevenue: totalInvoices._sum.amount ?? 0,
    },
    recentCases,
    todaySessions,
  })
})
