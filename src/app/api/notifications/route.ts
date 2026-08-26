import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser } from '@/lib/auth-server'

export async function GET(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const user = auth.user
  const notifs = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json(notifs)
}

export async function PATCH(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response
  const user = auth.user
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } })
  return NextResponse.json({ ok: true })
}
