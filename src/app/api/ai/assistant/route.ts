import { NextRequest, NextResponse } from 'next/server'
import { requireOfficeUser, requireVerifiedEmail } from '@/lib/auth-server'
import { rateLimit } from '@/lib/api-security'
import { auditLog } from '@/lib/audit'
import { withErrorHandling } from '@/lib/api-handler'
import { askLegalRag, isLegalRagConfigured, LegalRagError } from '@/lib/ai/legal-rag-client'
import { completeAiCall, reserveAiCall } from '@/lib/ai/usage'
import { deleteOwnConversation, findOwnConversation, historyFor, maybePurgeExpiredConversations, recordExchange } from '@/lib/ai/conversations'

// Mirrors ailegal_hussein's own limit (its /api/chat schema caps `question`
// at 2000) — a clear Dostoori-side 400 instead of a passthrough error.
const MAX_MESSAGE_LENGTH = 2000
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// Calls ailegal_hussein's grounded RAG pipeline. Phase 2: follow-up context
// comes from the SERVER-SIDE conversation (conversations.ts), scoped to this
// office + user + conversation. A `history` array in the request body is
// ignored — it is client-controlled and could carry forged "assistant" or
// "system" turns. The client only ever sends the conversation id.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const unverified = requireVerifiedEmail(auth.user)
  if (unverified) return unverified

  const limited = rateLimit(req, `ai:assistant:${auth.user.id}`, { limit: 20, windowMs: 60 * 60_000 })
  if (limited) return limited
  // Phase 2.1: expired conversations are removed without a cron job.
  maybePurgeExpiredConversations()

  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const requestedConversation = typeof body?.conversationId === 'string' ? body.conversationId : null

  if (!message) return NextResponse.json({ error: 'أدخل سؤالاً' }, { status: 400 })
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `السؤال طويل جداً (الحد الأقصى ${MAX_MESSAGE_LENGTH} حرفاً)` }, { status: 400 })
  }

  // Deny before processing: a conversation that is not this user's (another
  // user's, another office's, deleted, or guessed) is a 404 — nothing is
  // loaded, sent upstream, or counted.
  let conversationId: string | null = null
  if (requestedConversation) {
    const own = ID_RE.test(requestedConversation) ? await findOwnConversation(auth.user, requestedConversation) : null
    if (!own) return NextResponse.json({ error: 'المحادثة غير موجودة' }, { status: 404 })
    conversationId = own.id
  }

  if (!isLegalRagConfigured()) {
    return NextResponse.json({ error: 'خدمة المساعد الذكي غير مُفعّلة على هذا الخادم حالياً' }, { status: 503 })
  }
  const reservation = await reserveAiCall(auth.user, 'assistant', { payload: JSON.stringify([conversationId, message]) })
  if (!reservation.ok) return NextResponse.json({ error: reservation.message, code: reservation.reason }, { status: reservation.reason === 'duplicate_in_flight' ? 409 : 429 })

  const start = Date.now()
  try {
    const history = conversationId ? await historyFor(conversationId) : []
    const result = await askLegalRag(message, undefined, auth.user, history)

    const savedId = await recordExchange(auth.user, conversationId, message, {
      text: result.answer,
      mode: result.mode,
      groundingLevel: result.groundingLevel,
    })
    await auditLog(req, auth.user, 'ai.assistant_used', {
      metadata: { grounded: result.grounded, mode: result.mode, groundingLevel: result.groundingLevel, sourceCount: result.sources.length, historyTurns: history.length },
    })
    await completeAiCall(reservation.id, {
      success: true,
      latencyMs: Date.now() - start,
      usage: result.usage,
      model: result.provenance.chatModels.join(',') || undefined,
      groundingLevel: result.groundingLevel,
    })

    return NextResponse.json({
      conversationId: savedId,
      answer: result.answer,
      mode: result.mode,
      grounded: result.grounded,
      groundingLevel: result.groundingLevel,
      notices: result.notices,
      disclaimer: result.disclaimer,
      confidence: result.confidence,
      sources: result.sources,
      // Phase 2.1: whether the cited texts were checked against their official publication.
      sourceAuthority: result.sourceAuthority,
      provenance: { promptVersion: result.provenance.promptVersion, corpusVersion: result.provenance.corpusVersion },
    })
  } catch (err) {
    const ragError = err instanceof LegalRagError ? err : null
    await completeAiCall(reservation.id, { success: false, latencyMs: Date.now() - start, errorCode: ragError ? ragError.code : 'unknown_error' })
    if (ragError) return NextResponse.json({ error: ragError.message }, { status: ragError.status })
    console.error('[ai/assistant] unexpected failure', err)
    return NextResponse.json({ error: 'تعذّر الحصول على رد حالياً' }, { status: 502 })
  }
})

/** Deletes one of the caller's own conversations (and its messages). */
export const DELETE = withErrorHandling(async (req: NextRequest) => {
  const auth = await requireOfficeUser(req)
  if (!auth.ok) return auth.response
  const id = req.nextUrl.searchParams.get('conversationId') ?? ''
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'المحادثة غير موجودة' }, { status: 404 })
  const deleted = await deleteOwnConversation(auth.user, id)
  if (!deleted) return NextResponse.json({ error: 'المحادثة غير موجودة' }, { status: 404 })
  await auditLog(req, auth.user, 'ai.conversation_deleted', { entityType: 'ai_conversation', entityId: id })
  return NextResponse.json({ ok: true })
})
