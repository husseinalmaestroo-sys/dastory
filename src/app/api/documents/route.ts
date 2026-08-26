import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'

const LIST_CAP = 200

export async function GET(req: NextRequest) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const where = documentVisibilityWhere(auth.user)
  const [docs, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { case: { select: { number: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: LIST_CAP,
    }),
    prisma.document.count({ where }),
  ])
  return NextResponse.json(
    docs.map((doc) => ({ ...doc, url: `/api/documents/${doc.id}/download` })),
    { headers: { 'X-Total-Count': String(total) } }
  )
}
