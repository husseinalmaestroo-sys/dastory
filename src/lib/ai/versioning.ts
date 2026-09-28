import "server-only";
import { createHash } from "node:crypto";
import { queryOne } from "../db";
import { SERVABLE_SQL } from "../corpus/integrity";
import { logError } from "../error-log";
import { promptTemplateText } from "./prompts";

/**
 * What an answer depended on (Phase 2, step 45) — recorded in ai_requests and
 * returned with every response, so an answer can be traced to the exact
 * prompts, models and corpus state that produced it:
 *
 *   promptVersion  — hash of every prompt template and builder (prompts.ts);
 *   corpusVersion  — hash of the ready sources' ids/update times and the
 *                    chunk count: any ingest, re-index, amendment or deletion
 *                    changes it;
 *   models         — reported per request by the usage meter (the model that
 *                    actually served each call), plus the embedding model.
 *
 * Citations additionally carry their source id, title, article, version
 * status and effective date, so a future corpus update cannot make an old
 * answer's citations uninterpretable: the source row they name is recorded
 * with them, not just a position in a list.
 */

let promptVersionCache: string | null = null;

export function promptVersion(): string {
  if (!promptVersionCache) {
    promptVersionCache = `p2-${createHash("sha256").update(promptTemplateText()).digest("hex").slice(0, 12)}`;
  }
  return promptVersionCache;
}

let corpusCache: { at: number; value: string } | null = null;
const CORPUS_TTL_MS = 60_000;

export async function corpusVersion(): Promise<string> {
  if (corpusCache && Date.now() - corpusCache.at < CORPUS_TTL_MS) return corpusCache.value;
  try {
    const row = await queryOne<{ sig: string | null; chunks: string }>(
      `SELECT md5(string_agg(id::text || ':' || extract(epoch from updated_at)::bigint::text, ',' ORDER BY id)) AS sig,
              (SELECT count(*) FROM legal_documents)::text AS chunks
         FROM legal_sources WHERE status = 'ready' AND integrity_status IN (${SERVABLE_SQL})`
    );
    const value = `c-${createHash("sha256").update(`${row?.sig ?? "empty"}|${row?.chunks ?? "0"}`).digest("hex").slice(0, 12)}`;
    corpusCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    logError("[versioning] corpus version unavailable:", err);
    return "c-unknown";
  }
}

/** Test hook. */
export function resetVersionCaches(): void {
  promptVersionCache = null;
  corpusCache = null;
}
