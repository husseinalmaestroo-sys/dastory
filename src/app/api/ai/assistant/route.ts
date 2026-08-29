import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { askLegalRag, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { isUnderMonthlyAiCap, logAiUsage } from '@/lib/ai/usage'

// Mirrors ailegal_hussein's own limit (its /api/chat Zod schema caps
// `question` at 2000) — validating against the real upstream limit here
// gives a clear Dostoori-side 400 instead of a passthrough error.
const MAX_MESSAGE_LENGTH = 2000

// Replaces the previous direct-Anthropic implementation (see git history):
// this now calls ailegal_hussein's real grounded RAG pipeline, same as
// legal search — see src/app/api/search/legal/route.ts and ARCHITECTURE.md.
// One real
// consequence of the switch: ailegal_hussein's /api/chat is single-question,
// with no multi-turn context parameter, so a follow-up question is answered
// fresh each time rather than with memory of earlier turns in the same
// conversation — traded for real grounding/citations the old implementation
// never had. `history` is no longer read from the request body.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const limited = rateLimit(req, `ai:assistant:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!message) return NextResponse.json({ error: 'أدخل سؤالاً' }, { status: 400 })
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `السؤال طويل جداً (الحد الأقصى ${MAX_MESSAGE_LENGTH} حرفاً)` }, { status: 400 })
  }

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة المساعد الذكي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  if (!(await isUnderMonthlyAiCap(auth.user.officeId))) {
    return NextResponse.json({ error: 'تم بلوغ الحد الشهري لاستخدام المساعد الذكي لهذا المكتب' }, { status: 429 })
  }

  const start = Date.now()
  try {
    const result = await askLegalRag(message, undefined, auth.user.officeId)

    await auditLog(req, auth.user, 'ai.assistant_used', {
      metadata: { grounded: result.grounded, mode: result.mode, sourceCount: result.sources.length },
    })
    await logAiUsage(auth.user, 'assistant', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: true,
    })

    return NextResponse.json(result)
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await logAiUsage(auth.user, 'assistant', {
      model: 'ailegal_hussein', inputTokens: 0, outputTokens: 0,
      latencyMs: Date.now() - start, success: false,
      errorCode: ragError ? String(ragError.status) : 'unknown_error',
    })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/assistant] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر الحصول على رد حالياً' }, { status: 502 })
  }
})
