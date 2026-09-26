import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { timeEntryVisibilityWhere } from '@/lib/tenant-scope'
import { withErrorHandling } from '@/lib/api-handler'

// Time-log totals over every entry the caller may see (same scope as the
// list), computed in the database rather than from the rows loaded in the
// browser.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const [all, billable, invoiced] = await Promise.all([
    prisma.timeEntry.aggregate({ where: timeEntryVisibilityWhere(auth.user), _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: timeEntryVisibilityWhere(auth.user, { billable: true }), _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: timeEntryVisibilityWhere(auth.user, { invoiced: true }), _sum: { minutes: true } }),
  ])
  return NextResponse.json({
    totalMinutes: all._sum.minutes ?? 0,
    billableMinutes: billable._sum.minutes ?? 0,
    invoicedMinutes: invoiced._sum.minutes ?? 0,
  })
})
