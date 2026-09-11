import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { adminExtendTrialSubscription, getOfficeBillingStatus } from '@/lib/billing'

type RouteContext = { params: Promise<{ officeId: string }> }

export const POST = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `admin:office-extend-trial:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { officeId } = await params
  const office = await prisma.office.findUnique({ where: { id: officeId }, select: { id: true } })
  if (!office) return NextResponse.json({ error: 'المكتب غير موجود' }, { status: 404 })

  await adminExtendTrialSubscription(officeId)
  await auditLog(req, auth.user, 'admin.trial_extended', { entityType: 'office', entityId: officeId, officeId })

  return NextResponse.json({ ok: true, status: await getOfficeBillingStatus(officeId) })
})
