import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOfficeUser } from '@/lib/auth-server'
import { documentVisibilityWhere } from '@/lib/tenant-scope'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { isUnderMonthlyAiCap, logAiUsage } from '@/lib/ai/usage'
import { extractText, ExtractionError } from '@/lib/ai/extract-text'
import { readDocumentFile } from '@/lib/document-storage'
import { analyzeContract, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'

// Real documents run through real extraction and are genuinely capped, not
// silently truncated without telling the model/user — ~40k chars keeps a
// large contract well within a reasonable request cost while covering
// realistically-sized agreements.
const MAX_CONTRACT_CHARS = 40_000

interface ContractReviewResult {
  summary: string
  parties: string[]
  keyTerms: { label: string; value: string }[]
  risks: { severity: 'high' | 'medium' | 'low' | 'info'; title: string; excerpt: string; explanation: string }[]
}

function isValidResult(value: unknown): value is ContractReviewResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.summary === 'string' &&
    Array.isArray(v.parties) && v.parties.every((p) => typeof p === 'string') &&
    Array.isArray(v.keyTerms) && v.keyTerms.every((t) => t && typeof t === 'object' && typeof (t as any).label === 'string' && typeof (t as any).value === 'string') &&
    Array.isArray(v.risks) && v.risks.every((r) =>
      r && typeof r === 'object' &&
      ['high', 'medium', 'low', 'info'].includes((r as any).severity) &&
      typeof (r as any).title === 'string' && typeof (r as any).explanation === 'string'
    )
  )
}

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
  if (!(await isUnderMonthlyAiCap(auth.user.officeId))) {
    return NextResponse.json({ error: 'تم بلوغ الحد الشهري لاستخدام أدوات الذكاء الاصطناعي لهذا المكتب' }, { status: 429 })
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
    const message = err instanceof ExtractionError ? err.message : 'تعذّر استخراج نص العقد من هذا الملف'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  const contractText = extracted.text.slice(0, MAX_CONTRACT_CHARS)
  const truncated = extracted.text.length > MAX_CONTRACT_CHARS

  const start = Date.now()
  try {
    const result = await analyzeContract(contractText, auth.user.officeId)

    if (!isValidResult(result)) {
      await logAiUsage(auth.user, 'contract_review', {
        model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
        latencyMs: Date.now() - start, success: false, errorCode: 'malformed_output',
      })
      return NextResponse.json({ error: 'تعذّر تحليل استجابة الذكاء الاصطناعي — حاول مرة أخرى' }, { status: 502 })
    }

    // Enforce the "no invented quotes" rule server-side too, not just via
    // the prompt: drop any excerpt that doesn't actually appear in the
    // extracted text rather than trust the model's (or the upstream
    // service's) compliance.
    const verifiedRisks = result.risks.map((r) => ({
      ...r,
      excerpt: r.excerpt && contractText.includes(r.excerpt) ? r.excerpt : '',
    }))

    await auditLog(req, auth.user, 'ai.contract_reviewed', {
      entityType: 'document', entityId: doc.id,
      metadata: { extractionMethod: extracted.method, truncated, riskCount: verifiedRisks.length, sourceCount: result.sources.length },
    })
    await logAiUsage(auth.user, 'contract_review', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: true,
    })

    return NextResponse.json({
      summary: result.summary,
      parties: result.parties,
      keyTerms: result.keyTerms,
      risks: verifiedRisks,
      sources: result.sources,
      extractionMethod: extracted.method,
      truncated,
      disclaimer: 'تحليل آلي أولي بالذكاء الاصطناعي — لا يغني عن مراجعة محامٍ مرخّص، وقد يفوّت بنوداً أو يسيء تفسيرها.',
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await logAiUsage(auth.user, 'contract_review', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: false,
      errorCode: ragError ? String(ragError.status) : 'unknown_error',
    })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/contract-review] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تحليل العقد حالياً' }, { status: 502 })
  }
})
