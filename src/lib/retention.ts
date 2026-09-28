import "server-only";
import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { env } from "./env";
import { getPool, query } from "./db";
import { logError } from "./error-log";

/**
 * CONTENT RETENTION (Phase 2, steps 43/44).
 *
 * Dostoori (service) calls leave no content here at all. What remains is the
 * standalone app's own users' content: chat_history (questions + answers),
 * search_log (query text), uploaded_cases (extracted case text + analysis)
 * and the stored case PDFs — previously kept forever. This deletes every row
 * and file older than CONTENT_RETENTION_DAYS, and removes a whole session's
 * content on request (deleteSessionContent). Accounting rows (ai_requests,
 * cost_ledger, rate buckets) carry no content and are pruned separately.
 *
 * Deletion is real deletion: rows are DELETEd (no soft-delete flag) and the
 * PDF files are unlinked. Database backups (Neon point-in-time restore)
 * keep deleted rows for the provider's retention window — outside this
 * code's control and documented as such.
 */

function insideStorage(path: string): boolean {
  const root = resolve(process.cwd(), env.storageDir) + sep;
  return resolve(path).startsWith(root);
}

async function unlinkStored(paths: (string | null)[]): Promise<number> {
  let n = 0;
  for (const p of paths) {
    if (!p || !insideStorage(p)) continue;
    try {
      await unlink(p);
      n++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") logError(`[retention] could not delete ${p}:`, err);
    }
  }
  return n;
}

export type PurgeReport = {
  chatHistory: number;
  searchLog: number;
  uploadedCases: number;
  files: number;
  aiRequests: number;
  nonces: number;
  /** Phase 2.1: error_log rows (their messages can quote model output) past the content window. */
  errorLog: number;
};

export async function purgeExpiredContent(days = env.retentionDays, accountingDays = env.accountingRetentionDays): Promise<PurgeReport> {
  const cases = await query<{ file_path: string | null }>(
    `DELETE FROM uploaded_cases WHERE created_at < now() - ($1 || ' days')::interval RETURNING file_path`,
    [days]
  );
  const chat = await query(`DELETE FROM chat_history WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [days]);
  const search = await query(`DELETE FROM search_log WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [days]);
  const ai = await query(`DELETE FROM ai_requests WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [accountingDays]);
  const nonces = await query(`DELETE FROM service_request_nonces WHERE expires_at < now() RETURNING jti`);
  const errors = await query(`DELETE FROM error_log WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [days]);
  const files = await unlinkStored(cases.map((c) => c.file_path));
  return {
    chatHistory: chat.length,
    searchLog: search.length,
    uploadedCases: cases.length,
    files,
    aiRequests: ai.length,
    nonces: nonces.length,
    errorLog: errors.length,
  };
}

// ---------------------------------------------------------------- automatic retention (Phase 2.1)

/** How often the purge may run, across all instances. */
const AUTO_PURGE_INTERVAL_HOURS = 6;
let lastAttempt = 0;
let inFlight: Promise<PurgeReport | null> | null = null;

/**
 * Runs the purge if it has not run in the last AUTO_PURGE_INTERVAL_HOURS
 * anywhere in the deployment. Retention used to depend on an operator
 * installing a daily cron job (scripts/purge-content.ts); without it, content
 * was kept forever. Now every AI request calls this (fire-and-forget): a
 * process tries at most once per interval, a session-level advisory lock keeps
 * two instances from purging at once, and maintenance_runs records the last
 * run so a restart does not purge again early. Returns the report, or null
 * when it did not run. `force` is for tests and the CLI.
 */
export function runRetentionIfDue(opts: { force?: boolean } = {}): Promise<PurgeReport | null> {
  if (!opts.force && (!env.autoRetention || Date.now() - lastAttempt < AUTO_PURGE_INTERVAL_HOURS * 3_600_000)) return Promise.resolve(null);
  if (inFlight) return inFlight;
  lastAttempt = Date.now();
  inFlight = (async () => {
    const client = await getPool().connect();
    try {
      const lock = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext('dastoori-retention-purge')) AS ok`);
      if (!lock.rows[0]?.ok) return null;
      try {
        await client.query(`INSERT INTO maintenance_runs (task) VALUES ('retention') ON CONFLICT (task) DO NOTHING`);
        const due = await client.query(
          `UPDATE maintenance_runs SET last_run_at = now()
            WHERE task = 'retention' AND ($1::boolean OR last_run_at < now() - ($2 || ' hours')::interval)
            RETURNING task`,
          [!!opts.force, AUTO_PURGE_INTERVAL_HOURS]
        );
        if (due.rows.length === 0) return null;
        const report = await purgeExpiredContent();
        await client.query(`UPDATE maintenance_runs SET last_report = $1 WHERE task = 'retention'`, [JSON.stringify(report)]);
        console.log(JSON.stringify({ evt: "retention_purge", ...report }));
        return report;
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('dastoori-retention-purge'))`);
      }
    } finally {
      client.release();
    }
  })()
    .catch((err) => {
      logError("[retention] automatic purge failed:", err);
      return null;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test hook: lets the next call try again without waiting out the interval. */
export function resetRetentionClock(): void {
  lastAttempt = 0;
}

/** Removes everything this service holds for one standalone session (a user's deletion request). */
export async function deleteSessionContent(sessionId: string): Promise<PurgeReport> {
  const cases = await query<{ file_path: string | null }>(`DELETE FROM uploaded_cases WHERE session_id = $1 RETURNING file_path`, [sessionId]);
  const chat = await query(`DELETE FROM chat_history WHERE session_id = $1 RETURNING id`, [sessionId]);
  const search = await query(`DELETE FROM search_log WHERE session_id = $1 RETURNING id`, [sessionId]);
  await query(`DELETE FROM anonymous_usage WHERE session_id = $1`, [sessionId]);
  const files = await unlinkStored(cases.map((c) => c.file_path));
  return { chatHistory: chat.length, searchLog: search.length, uploadedCases: cases.length, files, aiRequests: 0, nonces: 0, errorLog: 0 };
}

/** Office offboarding: the only per-office data here is content-free accounting. */
export async function deleteOfficeAccounting(officeId: string): Promise<number> {
  const rows = await query(`DELETE FROM ai_requests WHERE office_id = $1 RETURNING id`, [officeId]);
  await query(`DELETE FROM cost_ledger WHERE cost_key = $1`, [`office:${officeId}`]);
  await query(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE $1`, [`%svc:${officeId}:%`]);
  return rows.length;
}
