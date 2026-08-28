import "server-only";
import { query, queryOne } from "./db";
import { logError } from "./error-log";

/**
 * Postgres-backed fixed-window limiter, keyed on `bucket_key` in the
 * `rate_limit_buckets` table (db/schema.sql).
 *
 * This used to be a plain in-memory Map. That was a deliberate MVP call —
 * costs nothing, needs no Redis — but it has two failure modes a real
 * circuit breaker can't have: it resets on every restart/redeploy (so the
 * "daily" ceilings below were never really daily, just "since the process
 * last came up"), and it would silently multiply the effective limit by the
 * instance count the moment this ever runs behind a load balancer. Backing
 * it with the same Postgres the app already depends on for everything else
 * fixes both without adding new infra (Redis) this single-VPS deployment
 * doesn't otherwise need.
 *
 * Semantics are unchanged from the in-memory version: a key's window starts
 * on ITS OWN first request, not a clock-aligned boundary (avoids the classic
 * double-burst-at-the-edge problem a naive aligned window has). The single
 * UPSERT below does the check-and-increment atomically — Postgres's row lock
 * on the conflicting key serializes two concurrent requests for the same
 * key, so they can never both land as "the Nth request."
 */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

// Opportunistic cleanup, not a cron job this project doesn't otherwise have:
// low odds on a write, cheap indexed DELETE, never blocking the caller.
const CLEANUP_CHANCE = 0.01;

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  try {
    const row = await queryOne<{ count: number; reset_at: string }>(
      `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
       VALUES ($1, 1, now() + ($2 || ' seconds')::interval)
       ON CONFLICT (bucket_key) DO UPDATE SET
         count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
         reset_at = CASE WHEN rate_limit_buckets.reset_at <= now()
                         THEN now() + ($2 || ' seconds')::interval
                         ELSE rate_limit_buckets.reset_at END
       RETURNING count, reset_at`,
      [key, windowSec]
    );

    if (Math.random() < CLEANUP_CHANCE) {
      void query(`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 day'`).catch((err) =>
        logError("[ratelimit] cleanup failed:", err)
      );
    }

    const { count } = row!;
    if (count > limit) {
      const resetAt = new Date(row!.reset_at).getTime();
      return { ok: false, remaining: 0, retryAfterSec: Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)) };
    }
    return { ok: true, remaining: limit - count, retryAfterSec: 0 };
  } catch (err) {
    // Fail OPEN: a limiter that can itself take the app down on a transient
    // DB hiccup is a worse failure mode than briefly under-enforcing a
    // limit. Retrieval already depends on this same database being up, so a
    // real outage breaks the app regardless of what this returns.
    logError(`[ratelimit] check failed for "${key}", allowing the request:`, err);
    return { ok: true, remaining: limit, retryAfterSec: 0 };
  }
}

export const LIMITS = {
  chat: { limit: 20, windowSec: 60 * 10 },     // 20 questions / 10 min, per lawyer/session
  upload: { limit: 5, windowSec: 60 * 60 },    // 5 PDFs / hour, per session
  draft: { limit: 10, windowSec: 60 * 60 },    // per session
  // Refining one section is far cheaper than generating a whole document
  // (a fraction of the tokens, see draft/refine/route.ts's maxTokens), and a
  // lawyer polishing a single draft may reasonably click a refine button
  // several times per section — hence more generous than `draft` itself.
  refine: { limit: 40, windowSec: 60 * 60 },   // per lawyer

  // Daily ceilings below are keyed on IP hash, not lawyer id or session — see
  // env.ts's costCapPerUserUsd for why: both a session cookie and a lawyer
  // registration are free (or nearly free) for a caller to mint fresh, so a
  // limit keyed on either resets right along with them. IP is the one
  // identity that doesn't. These bound sheer request VOLUME regardless of
  // dollar cost; costcap.ts bounds the dollars directly — the two are
  // deliberately separate defenses, not one derived from the other.
  chatDailyIp: { limit: 150, windowSec: 60 * 60 * 24 },   // ~10x the busiest real session-day measured so far
  uploadDailyIp: { limit: 15, windowSec: 60 * 60 * 24 },
  draftDailyIp: { limit: 30, windowSec: 60 * 60 * 24 },
  refineDailyIp: { limit: 80, windowSec: 60 * 60 * 24 },
};
