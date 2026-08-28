import { prisma } from '@/lib/prisma'

type UsageActor = { id: string; officeId: string }

/**
 * Records that an AI call happened — never what was asked or answered. A
 * client's legal question or a contract's contents is exactly the kind of
 * sensitive data that must not end up sitting in a queryable log table.
 * This is the ONLY place AI call outcomes are persisted; console.error below
 * (used for actual failures) logs the error message, never request/response
 * bodies.
 */
export async function logAiUsage(
  actor: UsageActor,
  feature: 'assistant' | 'contract_review',
  outcome: { model: string; inputTokens: number; outputTokens: number; latencyMs: number; success: boolean; errorCode?: string }
) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        officeId: actor.officeId,
        userId: actor.id,
        feature,
        model: outcome.model,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        latencyMs: outcome.latencyMs,
        success: outcome.success,
        errorCode: outcome.errorCode,
      },
    })
  } catch (error) {
    console.error('logAiUsage failed', error)
  }
}

/**
 * Monthly per-office call cap — the real cost-protection backstop beyond
 * per-request rate limiting (which only bounds *burst* rate, not total
 * monthly spend). Deliberately generous defaults since no billing plan is
 * connected yet (see Plan/Subscription models) to derive a real limit from;
 * tighten this once a plan's aiCallsPerMonth is actually enforced.
 */
const DEFAULT_MONTHLY_CAP = 500

export async function isUnderMonthlyAiCap(officeId: string): Promise<boolean> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const count = await prisma.aiUsageLog.count({
    where: { officeId, createdAt: { gte: startOfMonth } },
  })
  return count < DEFAULT_MONTHLY_CAP
}
