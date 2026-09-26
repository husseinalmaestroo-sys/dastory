import "server-only";
import { query } from "./db";
import { logError } from "./error-log";

export type UsageEvent = {
  sessionId: string;
  question: string;
  answer: string;
  sourcesUsed: unknown[];
  grounded: boolean;
  /**
   * grounded | general | refused.
   *
   * `grounded` alone is not enough for the dashboard now that the general
   * fallback exists: false means either "refused for lack of a source" or
   * "answered from general knowledge" — very different outcomes that need
   * different responses from the admin (upload the missing law vs. nothing).
   */
  mode?: string | null;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  latencyMs: number;
  category?: string | null;
  hitCount: number;
  /**
   * The request's real estimated cost (usage meter, per-model pricing). The
   * cost ledger itself is charged by ai/request.ts — this is only the
   * standalone dashboard's per-session tally.
   */
  costUsd: number;
  /**
   * Phase 6 self-verification (self-verify.ts) result, for monitoring. `null`
   * fields mean the verifier didn't run at all (usedDirectSourceFallback, or
   * a non-grounded mode) — a real "not applicable" distinct from "ran and
   * passed clean", which an admin view needs to be able to tell apart.
   */
  verification?: {
    issues: string[];
    severity: string;
    action: string;
    repaired: boolean;
  } | null;
};

/**
 * Records one answered question across chat_history, anonymous_usage and
 * search_log — CONTENT retention for the standalone app's own users only.
 *
 * Phase 2: never called for service (Dostoori) requests — Dostoori is the
 * system of record for its offices' questions and documents, and this service
 * keeps only content-free accounting for them (ai_requests, ai/request.ts).
 * Standalone rows are deleted after CONTENT_RETENTION_DAYS (scripts/purge-content.ts).
 *
 * Never throws: analytics is a side effect of answering, and losing a counter
 * row must not turn a good answer into a 500 for the lawyer waiting on it.
 */
export async function recordUsage(e: UsageEvent): Promise<void> {
  try {
    const cost = e.costUsd;

    await query(
      `INSERT INTO chat_history
         (session_id, question, answer, sources_used, grounded, mode,
          tokens_in, tokens_out, latency_ms,
          verification_issues, verification_severity, verification_action, verification_repaired)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        e.sessionId,
        e.question,
        e.answer,
        JSON.stringify(e.sourcesUsed),
        e.grounded,
        e.mode ?? null,
        e.tokensIn,
        e.tokensOut,
        e.latencyMs,
        e.verification ? e.verification.issues : null,
        e.verification?.severity ?? null,
        e.verification?.action ?? null,
        e.verification?.repaired ?? null,
      ]
    );

    await query(
      `UPDATE anonymous_usage
          SET questions_count = questions_count + 1,
              tokens_used     = tokens_used + $2,
              estimated_cost  = estimated_cost + $3,
              last_seen_at    = now()
        WHERE session_id = $1`,
      [e.sessionId, e.tokensIn + e.tokensOut + e.embeddingTokens, cost]
    );

    await query(`INSERT INTO search_log (session_id, query, category, hit_count) VALUES ($1,$2,$3,$4)`, [
      e.sessionId,
      e.question.slice(0, 500),
      e.category ?? null,
      e.hitCount,
    ]);
  } catch (err) {
    logError("[analytics] failed to record usage:", err);
  }
}
