import "server-only";
import { query, queryOne } from "./db";
import { logError } from "./error-log";

/**
 * Postgres-backed daily USD circuit breakers — per-key (an IP hash) and
 * site-wide — backed by the `cost_ledger` table (db/schema.sql).
 *
 * This used to be an in-memory Map, same MVP tradeoff and same problem as
 * ratelimit.ts's old implementation: it reset on every restart/redeploy, so
 * the "daily" cap was never actually enforced for a full day if the process
 * ever restarted in between — and a restart is exactly the kind of ordinary
 * event (a deploy, a crash, a `next dev` reload) that must not be a backdoor
 * around the one thing standing between this app and an unbounded OpenAI/
 * Anthropic bill. Backing it with the same Postgres the app already
 * depends on elsewhere fixes that without adding new infra.
 *
 * One row per (cost_key, day). Site-wide spend for today is
 * SUM(usd) WHERE day = current_date — no reserved sentinel key needed here,
 * unlike the in-memory version this replaces.
 *
 * The one thing this can never do is stop the call that tips a bucket over —
 * a request's real cost is only known once the model has answered. So this
 * blocks every request AFTER the cap is crossed, never the one that crosses
 * it — the same before/after shape ratelimit.ts has (checked before the
 * work, incremented once the work is known).
 */

// Opportunistic cleanup, not a cron job this project doesn't otherwise have:
// low odds on a write, cheap indexed DELETE, never blocking the caller.
const CLEANUP_CHANCE = 0.01;

/** USD spent so far today under `key` (an IP hash). 0 for a key never seen today, or on a DB error. */
export async function costToday(key: string): Promise<number> {
  try {
    const row = await queryOne<{ usd: string }>(
      `SELECT usd FROM cost_ledger WHERE cost_key = $1 AND day = current_date`,
      [key]
    );
    return row ? Number(row.usd) : 0;
  } catch (err) {
    // Fail OPEN: see addCost's own comment — same reasoning applies to the
    // read side. A transient DB error must read as "nothing spent yet," not
    // block a lawyer's question.
    logError(`[costcap] costToday failed for "${key}", treating as 0:`, err);
    return 0;
  }
}

/** The whole site's spend today, across every key. 0 on a DB error (see costToday). */
export async function siteWideCostToday(): Promise<number> {
  try {
    const row = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(usd), 0) AS total FROM cost_ledger WHERE day = current_date`
    );
    return row ? Number(row.total) : 0;
  } catch (err) {
    logError("[costcap] siteWideCostToday failed, treating as 0:", err);
    return 0;
  }
}

/**
 * Call once per request, AFTER the real per-call cost is known — see
 * analytics.ts's recordUsage, the single place that already computes it.
 */
export async function addCost(key: string, usd: number): Promise<void> {
  if (usd <= 0) return;
  try {
    await query(
      `INSERT INTO cost_ledger (cost_key, day, usd) VALUES ($1, current_date, $2)
       ON CONFLICT (cost_key, day) DO UPDATE SET usd = cost_ledger.usd + $2`,
      [key, usd]
    );

    if (Math.random() < CLEANUP_CHANCE) {
      void query(`DELETE FROM cost_ledger WHERE day < current_date - interval '30 days'`).catch((err) =>
        logError("[costcap] cleanup failed:", err)
      );
    }
  } catch (err) {
    // Fail OPEN, deliberately: recordUsage's own try/catch would swallow this
    // anyway (analytics is a side effect of answering and must never turn a
    // good answer into a 500), but a dedicated message here says exactly
    // what failed — this request's cost silently did NOT count toward any
    // cap — rather than a generic "failed to record usage" burying it.
    logError(`[costcap] addCost failed for "${key}" — this request's cost was not recorded toward any cap:`, err);
  }
}
