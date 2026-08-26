import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { deleteDocumentFile } from '@/lib/document-storage'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `documents:delete:${auth.user.id}`, { limit: 30, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const existing = await prisma.document.findFirst({
    where: documentVisibilityWhere(auth.user, { id }),
    select: { id: true, url: true, name: true, caseId: true },
  })
  if (!existing) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })

  // DB row first — if this fails, nothing else has happened. Only once the
  // row is confirmed gone do we touch the file, so a failed delete never
  // leaves a file gone with the row still referencing it.
  await prisma.document.delete({ where: { id: existing.id } })

  // Best-effort: deleteDocumentFile() already handles a missing file and a
  // path outside the allowed storage root safely (see src/lib/document-storage.ts).
  await deleteDocumentFile(existing.url)

  await auditLog(req, auth.user, 'document.deleted', {
    entityType: 'document',
    entityId: existing.id,
    metadata: { name: existing.name, caseId: existing.caseId },
  })
  return NextResponse.json({ ok: true })
}
