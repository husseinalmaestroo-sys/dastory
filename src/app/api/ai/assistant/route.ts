import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { askLegalRag, isLegalRagConfigured, LegalRagError, type ChatTurn } from '@/lib/ai/legal-rag-client'
import { isUnderMonthlyAiCap, logAiUsage } from '@/lib/ai/usage'

// Mirrors ailegal_hussein's own limit (its /api/chat Zod schema caps
// `question` at 2000) — validating against the real upstream limit here
// gives a clear Dostoori-side 400 instead of a passthrough error.
const MAX_MESSAGE_LENGTH = 2000

// How many prior turns to forward for follow-up context. ailegal_hussein
// caps `history` at 12 and only uses it to rewrite the follow-up into a
// standalone question; 10 (≈5 exchanges) is plenty for that and keeps the
// forwarded payload small.
const MAX_HISTORY_TURNS = 10

/**
 * Prior conversation turns from the request body, sanitised: right shape,
 * trimmed, non-empty, length-capped, most recent MAX_HISTORY_TURNS kept.
 * Anything malformed is dropped rather than 400'd — history is an optional
 * context hint, not the request.
 */
function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const turns: ChatTurn[] = []
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role
    const content = (item as { content?: unknown })?.content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    const trimmed = content.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (trimmed) turns.push({ role, content: trimmed })
  }
  return turns.slice(-MAX_HISTORY_TURNS)
}

// Calls ailegal_hussein's real grounded RAG pipeline (same backend as legal
// search — see src/app/api/search/legal/route.ts and ARCHITECTURE.md),
// replacing the old direct-Anthropic implementation (git history). Prior
// turns are forwarded as `history`: ailegal_hussein uses them only to
// rewrite a follow-up into a standalone question before its normal
// single-question pipeline runs, so multi-turn follow-ups work while every
// answer stays individually grounded and cited.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response

  const limited = rateLimit(req, `ai:assistant:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const history = parseHistory(body?.history)

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
    const result = await askLegalRag(message, undefined, auth.user.officeId, history)

    await auditLog(req, auth.user, 'ai.assistant_used', {
      metadata: { grounded: result.grounded, mode: result.mode, sourceCount: result.sources.length, historyTurns: history.length },
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
