import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { caseVisibilityWhere, clientVisibilityWhere, documentVisibilityWhere, invoiceVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { jsonWithMoney } from '@/lib/money'

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `search:${auth.user.id}`, { limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120)
  if (q.length < 2) return NextResponse.json({ query: q, clients: [], cases: [], invoices: [], documents: [] })

  const [clients, cases, invoices, documents] = await Promise.all([
    prisma.client.findMany({
      where: clientVisibilityWhere(auth.user, {
        active: true,
        OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }, { idNumber: { contains: q } }],
      }),
      select: { id: true, name: true, phone: true, email: true },
      take: 8,
    }),
    prisma.case.findMany({
      where: caseVisibilityWhere(auth.user, {
        OR: [{ number: { contains: q } }, { title: { contains: q } }, { type: { contains: q } }, { court: { contains: q } }],
      }),
      select: { id: true, number: true, title: true, status: true, client: { select: { name: true } } },
      take: 8,
    }),
    prisma.invoice.findMany({
      where: invoiceVisibilityWhere(auth.user, { number: { contains: q } }),
      select: { id: true, number: true, amount: true, status: true, dueDate: true, client: { select: { name: true } } },
      take: 8,
    }),
    prisma.document.findMany({
      where: documentVisibilityWhere(auth.user, { name: { contains: q } }),
      select: { id: true, name: true, type: true, case: { select: { number: true } } },
      take: 8,
    }),
  ])

  return jsonWithMoney({ query: q, clients, cases, invoices, documents })
})
