import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { analyzeCaseText, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { completeAiCall, reserveAiCall } from '@/lib/ai/usage'
import { extractText, ExtractionError } from '@/lib/ai/extract-text'
import { readDocumentFile } from '@/lib/document-storage'

// Same order as every other AI route: auth -> rate limit -> input shape ->
// tenant-scoped lookup (cross-office documentId must 404 regardless of
// config) -> is the service even reachable -> monthly cost cap -> the
// expensive part. Analyzes a *dispute* file (parties as plaintiff/
// defendant, possible defenses) via ailegal_hussein's /api/cases — not a
// bilateral agreement, which contract-review (route.ts next to this one)
// sends to ailegal_hussein's separate /api/contract-review instead.
// The engine accepts up to 400k chars of case text and reports exactly how
// much it analysed (coverage); beyond that Dostoori itself cuts, and says so.
const MAX_CASE_CHARS = 400_000

export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified

  const limited = rateLimit(req, `ai:case-analysis:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!documentId) return NextResponse.json({ error: 'المستند مطلوب' }, { status: 400 })

  const doc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id: documentId }) })
  if (!doc || !doc.url) return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 })

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة تحليل القضايا بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  let bytes: Buffer
  try {
    bytes = await readDocumentFile(doc.url)
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة الملف من التخزين' }, { status: 404 })
  }

  // Phase 2: Dostoori extracts the text itself (same pipeline as contract
  // review, OCR included) and sends only the text — the file never leaves
  // Dostoori, and the engine stores nothing from the call.
  let extracted: Awaited<ReturnType<typeof extractText>>
  try {
    extracted = await extractText(bytes, doc.type)
  } catch (err) {
    if (err instanceof ExtractionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[ai/case-analysis] unexpected extraction failure', err)
    return NextResponse.json({ error: 'تعذّر استخراج نص ملف القضية' }, { status: 422 })
  }
  const caseText = extracted.text.slice(0, MAX_CASE_CHARS)
  const cutLocally = extracted.text.length > MAX_CASE_CHARS

  const reservation = await reserveAiCall(auth.user, 'case_analysis')
  if (!reservation.ok) return NextResponse.json({ error: reservation.message, code: reservation.reason }, { status: 429 })

  const start = Date.now()
  try {
    const result = await analyzeCaseText(caseText, doc.name, auth.user)
    const coverage = {
      ...result.coverage,
      // What the engine saw is measured against the whole extracted file.
      totalChars: extracted.text.length,
      partial: result.coverage.partial || cutLocally,
    }

    await auditLog(req, auth.user, 'ai.case_analyzed', {
      entityType: 'document', entityId: doc.id,
      metadata: { extractionMethod: extracted.method, sourceCount: result.sources.length, groundingLevel: result.groundingLevel, partial: coverage.partial },
    })
    await completeAiCall(reservation.id, {
      success: true,
      latencyMs: Date.now() - start,
      usage: result.usage,
      model: result.provenance.chatModels.join(',') || undefined,
      groundingLevel: result.groundingLevel,
    })

    return NextResponse.json({
      fileName: doc.name,
      extractionMethod: extracted.method,
      analysis: result.analysis,
      groundingLevel: result.groundingLevel,
      coverage,
      sources: result.sources,
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await completeAiCall(reservation.id, { success: false, latencyMs: Date.now() - start, errorCode: ragError ? ragError.code : 'unknown_error' })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/case-analysis] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تحليل ملف القضية حالياً' }, { status: 502 })
  }
})
