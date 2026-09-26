import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { withErrorHandling } from '@/lib/api-handler'
import { auditLog } from '@/lib/audit'
import { askLegalRag, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { completeAiCall, reserveAiCall } from '@/lib/ai/usage'

const MAX_QUESTION_LENGTH = 2000 // mirrors ailegal_hussein's own Body schema (src/app/api/chat/route.ts)

// Same validation order as the other AI routes (assistant, contract-review):
// auth -> rate limit -> input shape -> is the service even reachable ->
// monthly cost cap -> the actual (expensive, upstream-calling) work.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified

  const limited = rateLimit(req, `ai:legal-search:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'أدخل سؤالاً' }, { status: 400 })
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: `السؤال طويل جداً (الحد الأقصى ${MAX_QUESTION_LENGTH} حرفاً)` }, { status: 400 })
  }
  const rawFilters = body?.filters
  const filters =
    rawFilters && typeof rawFilters === 'object'
      ? {
          category: typeof rawFilters.category === 'string' ? rawFilters.category.slice(0, 100) : undefined,
          court: typeof rawFilters.court === 'string' ? rawFilters.court.slice(0, 100) : undefined,
          year: typeof rawFilters.year === 'number' && Number.isInteger(rawFilters.year) && rawFilters.year > 1900 && rawFilters.year < 2200 ? rawFilters.year : undefined,
        }
      : undefined

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة البحث القانوني غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  const reservation = await reserveAiCall(auth.user, 'legal_search')
  if (!reservation.ok) return NextResponse.json({ error: reservation.message, code: reservation.reason }, { status: 429 })

  const start = Date.now()
  try {
    const result = await askLegalRag(question, filters, auth.user)

    await auditLog(req, auth.user, 'ai.legal_search', {
      metadata: { grounded: result.grounded, mode: result.mode, groundingLevel: result.groundingLevel, sourceCount: result.sources.length },
    })
    // Real usage as reported by the engine (every model call it made).
    await completeAiCall(reservation.id, {
      success: true,
      latencyMs: Date.now() - start,
      usage: result.usage,
      model: result.provenance.chatModels.join(',') || undefined,
      groundingLevel: result.groundingLevel,
    })

    // Usage is accounting data for Dostoori, not something the browser needs.
    return NextResponse.json({ ...result, usage: undefined })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await completeAiCall(reservation.id, { success: false, latencyMs: Date.now() - start, errorCode: ragError ? ragError.code : 'unknown_error' })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[search/legal] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر تنفيذ البحث القانوني حالياً' }, { status: 502 })
  }
})
