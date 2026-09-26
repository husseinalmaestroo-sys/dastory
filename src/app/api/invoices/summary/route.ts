import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { invoiceVisibilityWhere } from '@/lib/tenant-scope'
import { withErrorHandling } from '@/lib/api-handler'
import { jsonWithMoney } from '@/lib/money'

// Totals for the invoices page, computed in the database over EVERY invoice
// the caller may see (same scope as the list) with exact DECIMAL sums —
// not by adding up whichever rows happen to be loaded in the browser.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const where = invoiceVisibilityWhere(auth.user)
  const [totals, paidCount] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { amount: true, paid: true }, _count: { _all: true } }),
    prisma.invoice.count({ where: invoiceVisibilityWhere(auth.user, { status: 'PAID' }) }),
  ])
  const totalAmount = totals._sum.amount ?? null
  const totalPaid = totals._sum.paid ?? null
  return jsonWithMoney({
    count: totals._count._all,
    paidCount,
    totalAmount: totalAmount ?? 0,
    totalPaid: totalPaid ?? 0,
    // Decimal subtraction — exact.
    totalOutstanding: totalAmount && totalPaid ? totalAmount.minus(totalPaid) : (totalAmount ?? 0),
  })
})
