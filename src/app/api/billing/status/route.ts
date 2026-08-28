import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser } from '@/lib/auth-server'
import { withErrorHandling } from '@/lib/api-handler'
import { getOfficeBillingStatus } from '@/lib/billing'

export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const status = await getOfficeBillingStatus(auth.user.officeId)
  return NextResponse.json({
    ...status,
    // Explicit, not inferred by the client from the absence of a price:
    // billing is architecture-only, no payment provider is connected.
    paymentProviderConnected: false,
  })
})
