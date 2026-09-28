import { createHmac } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { EngineUsage } from './engine-schema'

type UsageActor = { id: string; officeId: string }

export type AiFeature = 'assistant' | 'contract_review' | 'legal_search' | 'case_analysis' | 'contract_draft'

/**
 * AI QUOTA ARCHITECTURE (Phase 2) — three independent limits, all enforced
 * atomically in one reservation, all counting only successful calls plus
 * reservations still in flight:
 *
 *  1. Office, per month, in CALLS — tenant-aware and plan-aware:
 *       ACTIVE subscription whose plan sets aiCallsPerMonth → that value;
 *       otherwise (trial / no subscription / before billing exists) →
 *       AI_DEFAULT_MONTHLY_CAP (500, the previous fixed cap).
 *     Plan limits apply once a subscription is ACTIVE — i.e. once billing
 *     (Phase 3, not built here) marks it so. Enforcing the trial plan's
 *     value today would cap every office at the entry plan, since no office
 *     can change plan yet; the trial allowance is a product decision, kept
 *     as configuration.
 *  2. User, per day, in CALLS — AI_USER_DAILY_CAP (default 50): one user
 *     cannot exhaust the office's month in an afternoon.
 *  3. Office, per month, in TOKENS — AI_OFFICE_MONTHLY_TOKEN_BUDGET (default
 *     5,000,000 input+output+embedding tokens, as reported by the engine).
 *     Calls are not equal: a segmented review of a long contract costs many
 *     chats. The budget is checked at reservation time against recorded
 *     usage, so it can be overshot by at most the calls already in flight.
 *
 * Failed calls (upstream down, timeout, invalid output, bad document) are
 * recorded with their error but do not consume any limit. Records metadata
 * only — never the question, the document or the answer.
 */
export const DEFAULT_MONTHLY_CAP = 500
const DEFAULT_USER_DAILY_CAP = 50
const DEFAULT_OFFICE_MONTHLY_TOKENS = 5_000_000

// A reservation whose call never completed (process crash) stops counting
// against the caps after this long.
const PENDING_TTL_MS = 10 * 60_000
const PENDING = 'pending'

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback
}

/** Start of the current month, UTC — the office cap window. */
function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
function dayStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const counted = () => ({
  OR: [{ success: true }, { errorCode: PENDING, createdAt: { gte: new Date(Date.now() - PENDING_TTL_MS) } }],
})

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** The office's monthly call cap (see the header). */
export async function officeMonthlyCap(officeId: string, tx: Tx | typeof prisma = prisma): Promise<number> {
  const sub = await tx.subscription.findUnique({ where: { officeId }, select: { status: true, plan: { select: { aiCallsPerMonth: true } } } })
  if (sub?.status === 'ACTIVE' && sub.plan.aiCallsPerMonth != null) return sub.plan.aiCallsPerMonth
  return envInt('AI_DEFAULT_MONTHLY_CAP', DEFAULT_MONTHLY_CAP)
}

export type Reservation =
  | { ok: true; id: string }
  | { ok: false; reason: 'office_monthly_cap' | 'user_daily_cap' | 'office_token_budget' | 'duplicate_in_flight'; message: string }

const REFUSALS = {
  office_monthly_cap: 'تم بلوغ الحد الشهري لاستخدام أدوات الذكاء الاصطناعي لهذا المكتب',
  user_daily_cap: 'تم بلوغ حدك اليومي لاستخدام أدوات الذكاء الاصطناعي، حاول غداً',
  office_token_budget: 'تم بلوغ الحد الشهري لحجم معالجة الذكاء الاصطناعي لهذا المكتب',
  duplicate_in_flight: 'الطلب نفسه قيد المعالجة بالفعل — انتظر نتيجته بدل إرساله مرة أخرى',
} as const

/**
 * Phase 2.1: the key of an in-flight request — an HMAC of the feature and the
 * request's payload, so an identical second request (a double submit, a
 * client retry while the first is still running) is refused instead of being
 * paid for twice. Keyed with the server secret: the column never holds
 * anything that could be matched against a guessed question, and it is
 * cleared when the call completes.
 */
export function inflightKeyFor(feature: AiFeature, payload: string): string {
  const secret = process.env.JWT_SECRET || process.env.AI_LEGAL_SERVICE_KEY || 'dostoori-inflight'
  return createHmac('sha256', secret).update(`${feature}\u0000${payload}`).digest('hex')
}

/**
 * Atomically claims one AI call against all three limits. Reservations for
 * the same office are serialized by locking that office's row for the length
 * of the count-and-insert, so N concurrent requests cannot all see "499 <
 * 500" and all proceed.
 */
export async function reserveAiCall(actor: UsageActor, feature: AiFeature, opts: { payload?: string } = {}): Promise<Reservation> {
  const inflightKey = opts.payload === undefined ? null : inflightKeyFor(feature, opts.payload)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Office\` WHERE \`id\` = ${actor.officeId} FOR UPDATE`

    // The same user's identical request still running (serialized by the
    // office lock above, so two concurrent submits cannot both pass).
    if (inflightKey) {
      const running = await tx.aiUsageLog.findFirst({
        where: { userId: actor.id, inflightKey, errorCode: PENDING, createdAt: { gte: new Date(Date.now() - PENDING_TTL_MS) } },
        select: { id: true },
      })
      if (running) return { ok: false, reason: 'duplicate_in_flight', message: REFUSALS.duplicate_in_flight } as const
    }

    const monthly = await tx.aiUsageLog.count({ where: { officeId: actor.officeId, createdAt: { gte: monthStartUtc() }, ...counted() } })
    if (monthly >= (await officeMonthlyCap(actor.officeId, tx))) return { ok: false, reason: 'office_monthly_cap', message: REFUSALS.office_monthly_cap } as const

    const daily = await tx.aiUsageLog.count({ where: { userId: actor.id, createdAt: { gte: dayStartUtc() }, ...counted() } })
    if (daily >= envInt('AI_USER_DAILY_CAP', DEFAULT_USER_DAILY_CAP)) return { ok: false, reason: 'user_daily_cap', message: REFUSALS.user_daily_cap } as const

    const tokens = await tx.aiUsageLog.aggregate({
      where: { officeId: actor.officeId, createdAt: { gte: monthStartUtc() }, success: true },
      _sum: { inputTokens: true, outputTokens: true, embeddingTokens: true },
    })
    const used = (tokens._sum.inputTokens ?? 0) + (tokens._sum.outputTokens ?? 0) + (tokens._sum.embeddingTokens ?? 0)
    if (used >= envInt('AI_OFFICE_MONTHLY_TOKEN_BUDGET', DEFAULT_OFFICE_MONTHLY_TOKENS)) {
      return { ok: false, reason: 'office_token_budget', message: REFUSALS.office_token_budget } as const
    }

    const row = await tx.aiUsageLog.create({
      data: { officeId: actor.officeId, userId: actor.id, feature, model: 'ailegal_hussein', latencyMs: 0, success: false, errorCode: PENDING, inflightKey },
      select: { id: true },
    })
    return { ok: true, id: row.id } as const
  })
}

/**
 * Finalizes a reservation with what the engine actually reported: every
 * token of every model call it made for this request (retrieval, answer,
 * verification…), the models, the estimated cost. A failed call keeps
 * success=false and so never counts against the limits.
 */
export async function completeAiCall(
  reservationId: string,
  outcome: { success: boolean; latencyMs: number; errorCode?: string; usage?: EngineUsage; model?: string; groundingLevel?: string | null }
): Promise<void> {
  const u = outcome.usage
  try {
    await prisma.aiUsageLog.update({
      where: { id: reservationId },
      data: {
        success: outcome.success,
        inflightKey: null,
        latencyMs: Math.max(0, Math.round(outcome.latencyMs)),
        errorCode: outcome.success ? null : (outcome.errorCode ?? 'unknown_error'),
        ...(outcome.model ? { model: outcome.model.slice(0, 190) } : {}),
        ...(u
          ? {
              inputTokens: Math.max(0, Math.round(u.tokensIn)),
              outputTokens: Math.max(0, Math.round(u.tokensOut)),
              embeddingTokens: Math.max(0, Math.round(u.embeddingTokens)),
              llmCalls: Math.max(0, Math.round(u.llmCalls)),
              costMicroUsd: Math.max(0, Math.round(u.estimatedCostUsd * 1_000_000)),
              engineRequestId: u.requestId.slice(0, 190),
            }
          : {}),
        ...(outcome.groundingLevel ? { groundingLevel: outcome.groundingLevel } : {}),
      },
    })
  } catch (error) {
    // The call itself already happened; failing the user's request over the
    // bookkeeping row would be worse. Logged, not swallowed.
    console.error('[ai-usage] failed to finalize usage row', reservationId, error)
  }
}

/** Current month's counted usage for an office (successful + in-flight). */
export async function monthlyAiUsage(officeId: string): Promise<number> {
  return prisma.aiUsageLog.count({ where: { officeId, createdAt: { gte: monthStartUtc() }, ...counted() } })
}
