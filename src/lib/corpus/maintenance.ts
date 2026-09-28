import "server-only";
import { getPool, query } from "../db";
import { env } from "../env";
import { setIntegrity } from "./integrity";
import { analyzeInventory, loadInventoryInput } from "./inventory";
import { listedSourceUrls, matchProvenance, type ProvenanceMatch } from "./provenance";

/**
 * Corpus maintenance actions behind scripts/corpus-integrity.ts (Phase 2.1),
 * here so they are testable without the CLI.
 */

/** Anomalies that make a text unfit to serve at all — not merely unverified. */
const QUARANTINE_KINDS = new Set(["garbled_text", "empty_source"]);

/**
 * Quarantines every servable source whose text is damaged: garbled
 * extraction, no chunks, or more than a fifth of its article numbers missing.
 * With apply=false it only reports what it would do.
 */
export async function autoQuarantine(actor: string, apply: boolean): Promise<{ sourceId: number; reason: string }[]> {
  const input = await loadInventoryInput(getPool());
  const report = analyzeInventory({ ...input, registry: [], servedModel: null, includeSynthetic: env.allowSyntheticCorpus });
  const targets = report.sources
    .filter((s) => s.integrity_status === "unverified" || s.integrity_status === "verified")
    .flatMap((s) => {
      const bad = s.anomalies.filter((a) => QUARANTINE_KINDS.has(a.kind) || (a.kind === "article_gaps" && a.severity === "critical"));
      return bad.length ? [{ sourceId: s.id, reason: bad.map((a) => `${a.kind}: ${a.detail}`).join(" | ") }] : [];
    });
  if (apply) for (const t of targets) await setIntegrity(t.sourceId, "quarantined", { actor, reason: `automatic: ${t.reason}` });
  return targets;
}

/**
 * Records where each source with unrecorded provenance came from, when its
 * stored file is one the download lists name (corpus/provenance.ts). Never
 * overwrites a recorded value. With apply=false it only reports the matches.
 */
export async function backfillProvenance(listsDir: string, apply: boolean): Promise<ProvenanceMatch[]> {
  const rows = await query<{ id: string; file_path: string | null }>(
    `SELECT id, file_path FROM legal_sources WHERE provenance IS NULL AND is_synthetic = false`
  );
  const matches = matchProvenance(
    rows.map((r) => ({ id: Number(r.id), file_path: r.file_path })),
    listedSourceUrls(listsDir)
  );
  if (apply) {
    for (const m of matches) {
      await query(
        `UPDATE legal_sources
            SET provenance = $2, source_url = COALESCE(source_url, $3), issuing_authority = COALESCE(issuing_authority, $4),
                acquired_at = COALESCE(acquired_at, created_at), updated_at = now()
          WHERE id = $1 AND provenance IS NULL`,
        [m.sourceId, m.provenance, m.url, m.authority]
      );
    }
  }
  return matches;
}
