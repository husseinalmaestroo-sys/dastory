import { prisma } from '@/lib/prisma'
import type { ChatTurn } from './legal-rag-client'

/**
 * Server-side assistant memory (Phase 2). The only conversation history ever
 * sent to the AI engine comes from here — scoped by office AND user AND
 * conversation — never from the browser, which used to be able to forge
 * "assistant" turns that were forwarded verbatim.
 */

type Actor = { id: string; officeId: string }

// ≈5 exchanges: enough to resolve a follow-up ("وهل ينطبق على…"); the engine
// uses history only to rewrite the follow-up into a standalone question.
const MAX_HISTORY_TURNS = 10
const MAX_TURN_CHARS = 4000

/** The actor's own conversation, or null — another user's (or office's) id is indistinguishable from a missing one. */
export async function findOwnConversation(actor: Actor, conversationId: string) {
  return prisma.aiConversation.findFirst({
    where: { id: conversationId, officeId: actor.officeId, userId: actor.id },
    select: { id: true },
  })
}

export async function historyFor(conversationId: string): Promise<ChatTurn[]> {
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_HISTORY_TURNS,
    select: { role: true, content: true },
  })
  return rows
    .reverse()
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content.slice(0, MAX_TURN_CHARS) }))
}

/** Records one completed exchange, creating the conversation on first use. Returns its id. */
export async function recordExchange(
  actor: Actor,
  conversationId: string | null,
  question: string,
  answer: { text: string; mode: string; groundingLevel: string }
): Promise<string> {
  // Explicit, distinct timestamps: the question must sort before its answer
  // even when both rows land in the same millisecond.
  const askedAt = new Date()
  const answeredAt = new Date(askedAt.getTime() + 1)
  return prisma.$transaction(async (tx) => {
    const id = conversationId ?? (await tx.aiConversation.create({ data: { officeId: actor.officeId, userId: actor.id }, select: { id: true } })).id
    await tx.aiMessage.create({ data: { conversationId: id, role: 'user', content: question, createdAt: askedAt } })
    await tx.aiMessage.create({ data: { conversationId: id, role: 'assistant', content: answer.text, mode: answer.mode, groundingLevel: answer.groundingLevel, createdAt: answeredAt } })
    await tx.aiConversation.update({ where: { id }, data: { updatedAt: answeredAt } })
    return id
  })
}

/** Deletes the actor's own conversation and its messages; false when it is not theirs. */
export async function deleteOwnConversation(actor: Actor, conversationId: string): Promise<boolean> {
  const res = await prisma.aiConversation.deleteMany({ where: { id: conversationId, officeId: actor.officeId, userId: actor.id } })
  return res.count > 0
}

// ---- retention (Phase 2.1) ----------------------------------------------------
// Conversations used to be kept forever. One untouched for
// AI_CONVERSATION_RETENTION_DAYS (default 90) is deleted with its messages
// (AiMessage cascades) — by the assistant route itself, at most every six
// hours per process, so retention does not depend on a cron job existing.

const DEFAULT_RETENTION_DAYS = 90
const PURGE_EVERY_MS = 6 * 3_600_000
let lastPurge = 0

export function conversationRetentionDays(): number {
  const v = Number(process.env.AI_CONVERSATION_RETENTION_DAYS)
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_RETENTION_DAYS
}

/** Deletes every conversation (and its messages) last touched before the retention window. Returns how many. */
export async function purgeExpiredConversations(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - conversationRetentionDays() * 86_400_000)
  const res = await prisma.aiConversation.deleteMany({ where: { updatedAt: { lt: cutoff } } })
  return res.count
}

/**
 * The purge, at most once per PURGE_EVERY_MS per process, never in the
 * request's path. Idempotent: two instances running it at once delete the
 * same rows once.
 */
export function maybePurgeExpiredConversations(): void {
  if (Date.now() - lastPurge < PURGE_EVERY_MS) return
  lastPurge = Date.now()
  void purgeExpiredConversations().catch((error) => console.error('[ai-conversations] retention purge failed', error))
}
