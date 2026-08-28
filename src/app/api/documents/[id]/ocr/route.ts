import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { extractText, ExtractionError } from '@/lib/ai/extract-text'
import { readDocumentFile } from '@/lib/document-storage'

type RouteContext = { params: Promise<{ id: string }> }

// Real OCR/text extraction on a document already uploaded and stored by
// this office (tenant-scoped via documentVisibilityWhere, same as every
// other per-document route) — never on arbitrary attacker-supplied paths,
// and never a canned response regardless of which document is requested.
export const POST = withErrorHandling(async (req: NextRequest, { params }: RouteContext) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const limited = rateLimit(req, `documents:ocr:${auth.user.id}`, { limit: 15, windowMs: 60 * 60_000 })
  if (limited) return limited

  const { id } = await params
  const doc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id }) })
  if (!doc || !doc.url) return NextResponse.json({ error: 'الملف غير موجود' }, { status: 404 })

  let bytes: Buffer
  try {
    bytes = await readDocumentFile(doc.url)
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة الملف من التخزين' }, { status: 404 })
  }

  const start = Date.now()
  try {
    const result = await extractText(bytes, doc.type)
    await auditLog(req, auth.user, 'document.ocr_run', {
      entityType: 'document',
      entityId: doc.id,
      metadata: { method: result.method, textLength: result.text.length, durationMs: Date.now() - start },
    })
    return NextResponse.json({
      text: result.text,
      method: result.method,
      pageCount: result.pageCount ?? null,
    })
  } catch (err) {
    const message = err instanceof ExtractionError ? err.message : 'تعذّر استخراج النص من هذا الملف'
    await auditLog(req, auth.user, 'document.ocr_failed', {
      entityType: 'document', entityId: doc.id,
      metadata: { reason: err instanceof ExtractionError ? 'extraction_error' : 'unexpected_error' },
    })
    if (!(err instanceof ExtractionError)) console.error('[documents/ocr] unexpected failure', err)
    return NextResponse.json({ error: message }, { status: 422 })
  }
})
