import "server-only";
import { query } from "./db";
import { estimateCost } from "./ai/pricing";
import { getChatProvider, getEmbeddingProvider } from "./ai";
import { addCost } from "./costcap";
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
   * Key for costcap.ts's daily circuit breakers — an IP hash from the calling
   * route, NOT sessionId. sessionId is free for a caller to mint fresh (see
   * ratelimit.ts), so a cost cap keyed on it would reset right along with the
   * cookie; IP hash is the identity that survives that.
   */
  costKey: string;
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
 * search_log.
 *
 * Never throws: analytics is a side effect of answering, and losing a counter
 * row must not turn a good answer into a 500 for the lawyer waiting on it.
 */
export async function recordUsage(e: UsageEvent): Promise<void> {
  try {
    // Price against the models that actually served the request, not against
    // OPENAI_CHAT_MODEL. Reading the OpenAI setting directly would bill a
    // Claude answer at gpt-4o-mini's rate — a ~40x under-report, and silent.
    const cost =
      estimateCost(getChatProvider().model, e.tokensIn, e.tokensOut) +
      estimateCost(getEmbeddingProvider().model, e.embeddingTokens, 0);

    // Before the DB writes below, deliberately: if a later write in this
    // function throws, the caller's actual OpenAI/Anthropic spend already
    // happened regardless, so the cost ledger must still count it. Safe to
    // over-count on a rare partial failure; unsafe to under-count a real
    // dollar. addCost has its own internal try/catch (costcap.ts) so a
    // failure here logs its own specific message rather than being folded
    // into this function's generic catch below.
    await addCost(e.costKey, cost);

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
