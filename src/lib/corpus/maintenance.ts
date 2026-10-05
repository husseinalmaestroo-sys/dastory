import "server-only";
import { getPool, query, transaction } from "../db";
import { parseLawNumber } from "../ingest/law-identity";
import { normalizeTitle } from "../ingest/title";
import { runIntegrityCheck } from "./check";
import { recordEvent } from "./integrity";
import { listedSourceUrls, matchProvenance, type ProvenanceMatch } from "./provenance";

/**
 * Corpus maintenance actions behind scripts/corpus-integrity.ts (Phase 2.1),
 * here so they are testable without the CLI.
 */

/**
 * Quarantines every served source whose text fails the integrity check
 * (corpus/check.ts): garbled, empty, unreadable chunks, or more than a fifth of
 * its article numbers missing. With apply=false it only reports what it would do.
 */
export async function autoQuarantine(actor: string, apply: boolean): Promise<{ sourceId: number; reason: string }[]> {
  const plan = await runIntegrityCheck({ apply, actor, recheck: true, quarantineOnly: true });
  return plan.map((p) => ({
    sourceId: p.sourceId,
    reason: p.findings.filter((f) => f.blocking).map((f) => `${f.kind}: ${f.detail}`).join(" | "),
  }));
}

/**
 * Records where each source with unrecorded provenance came from, when its
 * stored file is one the download lists name (corpus/provenance.ts). Never
 * overwrites a recorded value; every change is an event. With apply=false it
 * only reports the matches.
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
      const updated = await query<{ id: string }>(
        `UPDATE legal_sources
            SET provenance = $2, source_url = COALESCE(source_url, $3), issuing_authority = COALESCE(issuing_authority, $4),
                acquired_at = COALESCE(acquired_at, created_at), updated_at = now()
          WHERE id = $1 AND provenance IS NULL
          RETURNING id`,
        [m.sourceId, m.provenance, m.url, m.authority]
      );
      if (updated.length > 0) {
        await recordEvent(getPool(), m.sourceId, "provenance", null, m.provenance, {
          actor: "backfill-provenance",
          reason: `stored file matches a URL in the download lists (${m.authority})`,
          evidence: m.url,
        });
      }
    }
  }
  return matches;
}

const LEGISLATIVE_TYPES = new Set(["law", "regulation", "instruction"]);

/** A year the title states as the law's ("لسنة 1976", "لعام 2024") — never a stray number. */
export function framedLawYear(title: string): number | null {
  const m = normalizeTitle(title).match(/(?:لسنة|لسنه|لعام)\s*(\d{4})(?!\d)/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1900 && y <= new Date().getFullYear() + 1 ? y : null;
}

export type TitleFix = { sourceId: number; from: string; to: string; lawNumber: string | null; year: number | null };

/**
 * Title, law-number and year normalisation over stored sources (corpus
 * repair). The title is normalised for display (ingest/title.ts — tatweel,
 * diacritics, digits, underscores, a bracketed number, a reversed lam-alef; no
 * word changes). For legislation whose law number or year is NOT recorded, the
 * number is taken from the title's own "رقم N" and the year from its own
 * "لسنة YYYY" — read from the title, never guessed; a title without them
 * leaves the field empty (metadata incomplete). A recorded value is never
 * overwritten. Every change is a 'metadata' event; with apply=false nothing is
 * written.
 */
export async function normalizeTitles(apply: boolean): Promise<TitleFix[]> {
  const rows = await query<{ id: string; title: string; law_number: string | null; year: number | null; source_type: string }>(
    `SELECT id, title, law_number, year, source_type FROM legal_sources WHERE is_synthetic = false ORDER BY id`
  );
  const fixes: TitleFix[] = [];
  for (const r of rows) {
    const to = normalizeTitle(r.title);
    const legislative = LEGISLATIVE_TYPES.has(r.source_type);
    const lawNumber = legislative && r.law_number === null ? parseLawNumber(to) : null;
    const year = legislative && r.year === null ? framedLawYear(to) : null;
    if (to === r.title && lawNumber === null && year === null) continue;
    fixes.push({ sourceId: Number(r.id), from: r.title, to, lawNumber, year });
  }
  if (!apply) return fixes;
  const actor = "normalize-titles";
  for (const f of fixes) {
    await transaction(async (db) => {
      const res = await db.query(
        `UPDATE legal_sources SET title = $3, law_number = COALESCE(law_number, $4), year = COALESCE(year, $5), updated_at = now()
          WHERE id = $1 AND title = $2 RETURNING id`,
        [f.sourceId, f.from, f.to, f.lawNumber, f.year]
      );
      if (res.rows.length === 0) return; // changed meanwhile: left for the next run
      if (f.to !== f.from) {
        await db.query(`UPDATE legal_documents SET law_name = $3 WHERE source_id = $1 AND law_name = $2`, [f.sourceId, f.from, f.to]);
        await recordEvent(db, f.sourceId, "metadata", f.from, f.to, {
          actor,
          reason: "title normalised for display (tatweel, diacritics, digit forms, underscores, bracketed number, reversed lam-alef); no word changed",
        });
      }
      if (f.lawNumber !== null) {
        await db.query(`UPDATE legal_documents SET law_number = $2 WHERE source_id = $1 AND law_number IS NULL`, [f.sourceId, f.lawNumber]);
        await recordEvent(db, f.sourceId, "metadata", null, `law_number=${f.lawNumber}`, { actor, reason: `law number read from the title's own "رقم ${f.lawNumber}"` });
      }
      if (f.year !== null) {
        await recordEvent(db, f.sourceId, "metadata", null, `year=${f.year}`, { actor, reason: `year read from the title's own "لسنة ${f.year}"` });
      }
    });
  }
  return fixes;
}
