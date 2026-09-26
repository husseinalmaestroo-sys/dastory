import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { completeAiCall, reserveAiCall } from '@/lib/ai/usage'
import { extractText, ExtractionError } from '@/lib/ai/extract-text'
import { readDocumentFile } from '@/lib/document-storage'
import { analyzeContract, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'

// Sent in full up to the engine's own input limit; the engine reviews long
// contracts in segments and reports exactly which ranges it analysed. Beyond
// this limit Dostoori cuts the text itself — and the response says so. A
// review is never presented as complete when any part was not analysed.
const MAX_CONTRACT_CHARS = 200_000

// Order unchanged from the previous (Claude-direct) version: auth -> rate
// limit -> input shape -> tenant-scoped lookup (a cross-office documentId
// must 404 regardless of AI config) -> is the service even reachable ->
// monthly cost cap -> only then the expensive part (real text extraction,
// which may itself run real OCR, followed by the provider call).
//
// Now calls ailegal_hussein (real Jordanian legal corpus behind it) instead
// of Anthropic directly — extraction stays exactly as before, on Dostoori's
// own already-tested pipeline; only what happens with the extracted text
// changed. See ailegal_hussein/src/lib/ai/prompts.ts's
// buildContractReviewPrompt for the contract-shaped prompt this calls,
// deliberately separate from that service's litigation-shaped /api/cases.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified

  const limited = rateLimit(req, `ai:contract-review:${auth.user.id}`, { limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const documentId = typeof body?.documentId === 'string' ? body.documentId : ''
  if (!documentId) return NextResponse.json({ error: 'المستند مطلوب' }, { status: 400 })

  const doc = await prisma.document.findFirst({ where: documentVisibilityWhere(auth.user, { id: documentId }) })
  if (!doc || !doc.url) return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 })

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة مراجعة العقود بالذكاء الاصطناعي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  let bytes: Buffer
  try {
    bytes = await readDocumentFile(doc.url)
  } catch {
    return NextResponse.json({ error: 'تعذّر قراءة الملف من التخزين' }, { status: 404 })
  }

  let extracted: Awaited<ReturnType<typeof extractText>>
  try {
    extracted = await extractText(bytes, doc.type)
  } catch (err) {
    if (err instanceof ExtractionError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[ai/contract-review] unexpected extraction failure', err)
    return NextResponse.json({ error: 'تعذّر استخراج نص العقد من هذا الملف' }, { status: 422 })
  }

  const contractText = extracted.text.slice(0, MAX_CONTRACT_CHARS)
  const cutLocally = extracted.text.length > MAX_CONTRACT_CHARS

  // Reserved only now: a document that can't even be read never counts
  // against the office's monthly AI cap.
  const reservation = await reserveAiCall(auth.user, 'contract_review')
  if (!reservation.ok) return NextResponse.json({ error: reservation.message, code: reservation.reason }, { status: 429 })

  const start = Date.now()
  try {
    // Shape and citation markers already validated (engine-schema.ts); a
    // malformed response throws and is recorded as a failed call.
    const result = await analyzeContract(contractText, auth.user)

    // Enforce the "no invented quotes" rule server-side too, not just via
    // the prompt: drop any excerpt that doesn't actually appear in the
    // extracted text rather than trust the model's (or the upstream
    // service's) compliance.
    const verifiedRisks = result.risks.map((r) => ({
      ...r,
      excerpt: r.excerpt && contractText.includes(r.excerpt) ? r.excerpt : '',
    }))
    // ailegal_hussein always returns sources as an array (possibly empty);
    // coerce anyway so a shape change upstream degrades to "no sources"
    // rather than throwing on .length here.
    const sources = Array.isArray(result.sources) ? result.sources : []

    // Coverage against the WHOLE extracted document: the engine's own
    // not-analysed ranges plus anything Dostoori cut before sending.
    const notAnalyzed = [...result.coverage.notAnalyzed]
    if (cutLocally) {
      notAnalyzed.push({ fromChar: MAX_CONTRACT_CHARS + 1, toChar: extracted.text.length, startsWith: extracted.text.slice(MAX_CONTRACT_CHARS, MAX_CONTRACT_CHARS + 120).split('\n')[0].trim() })
    }
    const coverage = {
      totalChars: extracted.text.length,
      analyzedChars: result.coverage.analyzedChars,
      partial: result.coverage.partial || cutLocally,
      segments: result.coverage.segments,
      notAnalyzed,
    }

    await auditLog(req, auth.user, 'ai.contract_reviewed', {
      entityType: 'document', entityId: doc.id,
      metadata: { extractionMethod: extracted.method, partial: coverage.partial, riskCount: verifiedRisks.length, sourceCount: sources.length },
    })
    await completeAiCall(reservation.id, {
      success: true,
      latencyMs: Date.now() - start,
      usage: result.usage,
      model: result.provenance.chatModels.join(',') || undefined,
    })

    return NextResponse.json({
      summary: result.summary,
      parties: result.parties,
      keyTerms: result.keyTerms,
      risks: verifiedRisks,
      sources,
      extractionMethod: extracted.method,
      coverage,
      // Kept for older clients: true whenever ANY part was not analysed.
      truncated: coverage.partial,
      disclaimer: coverage.partial
        ? 'مراجعة جزئية: لم يُحلَّل جزء من العقد (انظر الأجزاء غير المحلَّلة). تحليل آلي أولي لا يغني عن مراجعة محامٍ مرخّص.'
        : 'تحليل آلي أولي بالذكاء الاصطناعي — لا يغني عن مراجعة محامٍ مرخّص، وقد يفوّت بنوداً أو يسيء تفسيرها.',
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await completeAiCall(reservation.id, { success: false, latencyMs: Date.now() - start, errorCode: ragError ? ragError.code : 'unknown_error' })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/contract-review] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تحليل العقد حالياً' }, { status: 502 })
  }
})
