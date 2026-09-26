import { prisma } from '@/lib/prisma'

type UsageActor = { id: string; officeId: string }

export type AiFeature = 'assistant' | 'contract_review' | 'legal_search' | 'case_analysis' | 'contract_draft'

/**
 * Monthly per-office call cap — the cost backstop beyond per-request rate
 * limiting (which only bounds *burst* rate). One fixed value for every
 * office: Plan.aiCallsPerMonth exists in the schema but no office can change
 * plan until billing exists (Phase 3), so enforcing per-plan values now would
 * permanently cap everyone at the trial plan's number.
 */
export const DEFAULT_MONTHLY_CAP = 500

// A reservation whose call never completed (process crash) stops counting
// against the cap after this long.
const PENDING_TTL_MS = 10 * 60_000
const PENDING = 'pending'

/** Start of the current month, UTC — the cap window. */
function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Atomically claims one AI call against the office's monthly cap and returns
 * the usage row id, or null when the cap is reached. Replaces a plain
 * count-then-call check, under which N concurrent requests could all see
 * "499 < 500" and all proceed. Reservations for the same office are
 * serialized by locking that office's row for the length of the
 * count-and-insert.
 *
 * What counts: successful calls, and reservations still in flight. Failed
 * calls (upstream down, timeout, bad document) are recorded but no longer
 * eat into the office's quota.
 *
 * Records metadata only — never the question, document, or answer.
 */
export async function reserveAiCall(actor: UsageActor, feature: AiFeature): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Office\` WHERE \`id\` = ${actor.officeId} FOR UPDATE`
    const used = await tx.aiUsageLog.count({
      where: {
        officeId: actor.officeId,
        createdAt: { gte: monthStartUtc() },
        OR: [
          { success: true },
          { errorCode: PENDING, createdAt: { gte: new Date(Date.now() - PENDING_TTL_MS) } },
        ],
      },
    })
    if (used >= DEFAULT_MONTHLY_CAP) return null
    const row = await tx.aiUsageLog.create({
      data: {
        officeId: actor.officeId,
        userId: actor.id,
        feature,
        model: 'ailegal_hussein',
        latencyMs: 0,
        success: false,
        errorCode: PENDING,
      },
      select: { id: true },
    })
    return row.id
  })
}

/**
 * Finalizes a reservation. ailegal_hussein doesn't report token counts over
 * its HTTP contract, so tokens stay 0 rather than a fabricated estimate.
 */
export async function completeAiCall(
  reservationId: string,
  outcome: { success: boolean; latencyMs: number; errorCode?: string }
): Promise<void> {
  try {
    await prisma.aiUsageLog.update({
      where: { id: reservationId },
      data: {
        success: outcome.success,
        latencyMs: Math.max(0, Math.round(outcome.latencyMs)),
        errorCode: outcome.success ? null : (outcome.errorCode ?? 'unknown_error'),
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
  return prisma.aiUsageLog.count({
    where: {
      officeId,
      createdAt: { gte: monthStartUtc() },
      OR: [{ success: true }, { errorCode: PENDING, createdAt: { gte: new Date(Date.now() - PENDING_TTL_MS) } }],
    },
  })
}
