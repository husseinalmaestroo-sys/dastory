import "server-only";
import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { env } from "./env";
import { query } from "./db";
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
};

export async function purgeExpiredContent(days = env.retentionDays, accountingDays = 400): Promise<PurgeReport> {
  const cases = await query<{ file_path: string | null }>(
    `DELETE FROM uploaded_cases WHERE created_at < now() - ($1 || ' days')::interval RETURNING file_path`,
    [days]
  );
  const chat = await query(`DELETE FROM chat_history WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [days]);
  const search = await query(`DELETE FROM search_log WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [days]);
  const ai = await query(`DELETE FROM ai_requests WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [accountingDays]);
  const nonces = await query(`DELETE FROM service_request_nonces WHERE expires_at < now() RETURNING jti`);
  const files = await unlinkStored(cases.map((c) => c.file_path));
  return { chatHistory: chat.length, searchLog: search.length, uploadedCases: cases.length, files, aiRequests: ai.length, nonces: nonces.length };
}

/** Removes everything this service holds for one standalone session (a user's deletion request). */
export async function deleteSessionContent(sessionId: string): Promise<PurgeReport> {
  const cases = await query<{ file_path: string | null }>(`DELETE FROM uploaded_cases WHERE session_id = $1 RETURNING file_path`, [sessionId]);
  const chat = await query(`DELETE FROM chat_history WHERE session_id = $1 RETURNING id`, [sessionId]);
  const search = await query(`DELETE FROM search_log WHERE session_id = $1 RETURNING id`, [sessionId]);
  await query(`DELETE FROM anonymous_usage WHERE session_id = $1`, [sessionId]);
  const files = await unlinkStored(cases.map((c) => c.file_path));
  return { chatHistory: chat.length, searchLog: search.length, uploadedCases: cases.length, files, aiRequests: 0, nonces: 0 };
}

/** Office offboarding: the only per-office data here is content-free accounting. */
export async function deleteOfficeAccounting(officeId: string): Promise<number> {
  const rows = await query(`DELETE FROM ai_requests WHERE office_id = $1 RETURNING id`, [officeId]);
  await query(`DELETE FROM cost_ledger WHERE cost_key = $1`, [`office:${officeId}`]);
  await query(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE $1`, [`%svc:${officeId}:%`]);
  return rows.length;
}
