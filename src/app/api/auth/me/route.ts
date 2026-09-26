import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPlatformAdmin, requireActiveUser } from '@/lib/auth-server'
import { withErrorHandling } from '@/lib/api-handler'

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireActiveUser(req)
  if (!auth.ok) return auth.response

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    include: { office: { select: { name: true } } },
  })

  if (!user) return NextResponse.json({ error: 'جلسة منتهية' }, { status: 401 })

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      officeId: user.officeId,
      officeName: user.office?.name ?? null,
      isPlatformAdmin: isPlatformAdmin(user),
      barNumber: user.barNumber,
      clientId: user.clientId ?? null,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: user.emailVerified,
    },
  })
})
