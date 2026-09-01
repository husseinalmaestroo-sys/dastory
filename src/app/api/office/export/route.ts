import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeManager } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { buildOfficeExport } from '@/lib/office-export'

// Office-wide data export (privacy policy §6 / PDPL). Manager-only — this
// returns every user's clients/cases/documents in the office, not just the
// caller's, so requireOfficeManager, not requireOfficeUser. Rate-limited on
// the office, not the user: it's an expensive full-table read + zip.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeManager(req)
  if (!auth.ok) return auth.response

  const limited = rateLimit(req, `office:export:${auth.user.officeId}`, { limit: 3, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { filename, buffer } = await buildOfficeExport(auth.user.officeId)

  await auditLog(req, auth.user, 'office.data_exported', {
    entityType: 'office',
    entityId: auth.user.officeId,
    metadata: { bytes: buffer.length },
  })

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})
