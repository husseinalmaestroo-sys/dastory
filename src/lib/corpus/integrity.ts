import "server-only";
import { getPool } from "../db";

/**
 * Corpus integrity (Phase 2.1).
 *
 * A source's text is only as good as its extraction: Gazette PDFs with broken
 * font maps yield fluent-looking garbage (ingest/quality.ts), a scanned law
 * loses its article numbering, a download can be the wrong law or truncated.
 * Until Phase 2.1 nothing recorded whether a served text had ever been checked
 * against the issuing authority's publication, and nothing could take a damaged
 * source out of service without deleting it (and its history).
 *
 * integrity_status (db/schema.sql) records that, separately from provenance
 * (where the text came from) and is_current_version (whether it is in force):
 *
 *   verified     compared with the official publication and found faithful
 *   unverified   not compared — served, but never presented as authoritative
 *   quarantined  damaged or suspect — never served
 *   replaced     superseded by a repaired re-ingest — never served, kept
 *
 * Every change is an append-only event (corpus_integrity_events): who, when,
 * from what to what, why, and against which evidence.
 */

export const INTEGRITY_STATUSES = ["verified", "unverified", "quarantined", "replaced"] as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number];

/** The statuses retrieval may serve. Quarantined and replaced sources never reach a prompt. */
export const SERVABLE_INTEGRITY: readonly IntegrityStatus[] = ["verified", "unverified"];
/** For SQL: `integrity_status IN (${SERVABLE_SQL})`. Literal on purpose — never user input. */
export const SERVABLE_SQL = SERVABLE_INTEGRITY.map((s) => `'${s}'`).join(", ");

export function isIntegrityStatus(s: string): s is IntegrityStatus {
  return (INTEGRITY_STATUSES as readonly string[]).includes(s);
}

/**
 * Whether a source may be presented as the authoritative text of the law:
 * published by the issuing authority itself, checked against that publication,
 * and not an evaluation fixture. Anything less is served with a label.
 */
export function isAuthoritative(s: { provenance?: string | null; integrity_status?: string | null; is_synthetic?: boolean | null }): boolean {
  return s.provenance === "official" && s.integrity_status === "verified" && s.is_synthetic !== true;
}

export type IntegrityChange = {
  /** Who decided: an operator's name/email, or "corpus-inventory (automatic)". */
  actor: string;
  reason: string;
  /** The official publication compared against — URL or sha256 of the file. Required to verify. */
  evidence?: string | null;
};

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function applyChange(db: Queryable, sourceId: number, to: IntegrityStatus, change: IntegrityChange, replacedBy: number | null = null): Promise<IntegrityStatus> {
  const cur = await db.query(`SELECT integrity_status FROM legal_sources WHERE id = $1 FOR UPDATE`, [sourceId]);
  if (cur.rows.length === 0) throw new Error(`Source ${sourceId} does not exist.`);
  const from = String(cur.rows[0].integrity_status) as IntegrityStatus;
  await db.query(
    `UPDATE legal_sources
        SET integrity_status = $2, integrity_note = $3, integrity_checked_at = now(), updated_at = now(),
            replaced_by = CASE WHEN $2 = 'replaced' THEN $4::bigint ELSE replaced_by END
      WHERE id = $1`,
    [sourceId, to, `${change.reason}${change.evidence ? ` — ${change.evidence}` : ""} (${change.actor})`, replacedBy]
  );
  await db.query(
    `INSERT INTO corpus_integrity_events (source_id, from_status, to_status, actor, reason, evidence)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sourceId, from, to, change.actor, change.reason, change.evidence ?? null]
  );
  return from;
}

function requireReason(change: IntegrityChange): void {
  if (!change.actor?.trim()) throw new Error("An integrity change needs an actor (who decided).");
  if (!change.reason?.trim()) throw new Error("An integrity change needs a reason.");
}

/**
 * Sets a source's integrity status, with an event. Verifying needs evidence
 * (the official publication compared against); a replaced source is set only
 * through replaceSource, which records its replacement.
 */
export async function setIntegrity(sourceId: number, to: IntegrityStatus, change: IntegrityChange): Promise<{ from: IntegrityStatus; to: IntegrityStatus }> {
  requireReason(change);
  if (to === "replaced") throw new Error("Use replaceSource to mark a source replaced — it records the replacement.");
  if (to === "verified" && !change.evidence?.trim()) {
    throw new Error("Verifying a source needs evidence: the official publication's URL or file hash it was compared against.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const from = await applyChange(client, sourceId, to, change);
    await client.query("COMMIT");
    return { from, to };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * A repaired re-ingest takes a damaged source's place: the new source inherits
 * the old one's legal-version position (current / superseded / amendment
 * links), the old one becomes 'replaced' (kept, never served) with a pointer to
 * its replacement. Both sides are logged. The new source must already be
 * ingested and ready, and must be the same law (same number and year, when the
 * titles carry them).
 */
export async function replaceSource(oldId: number, newId: number, change: IntegrityChange): Promise<void> {
  requireReason(change);
  if (oldId === newId) throw new Error("A source cannot replace itself.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, title, status, integrity_status, is_current_version, supersedes, amendment_of, law_number
         FROM legal_sources WHERE id = ANY($1::bigint[]) FOR UPDATE`,
      [[oldId, newId]]
    );
    const oldRow = rows.find((r) => Number(r.id) === oldId);
    const newRow = rows.find((r) => Number(r.id) === newId);
    if (!oldRow) throw new Error(`Source ${oldId} does not exist.`);
    if (!newRow) throw new Error(`Replacement source ${newId} does not exist.`);
    if (newRow.status !== "ready") throw new Error(`Replacement source ${newId} is not ready (status ${newRow.status}); ingest it first.`);
    if (newRow.integrity_status === "quarantined" || newRow.integrity_status === "replaced") {
      throw new Error(`Replacement source ${newId} is ${newRow.integrity_status}; it cannot replace anything.`);
    }
    const sameLaw = sameLawIdentity(String(oldRow.title), String(newRow.title), oldRow.law_number as string | null, newRow.law_number as string | null);
    if (!sameLaw.ok) throw new Error(`Source ${newId} is not the same law as ${oldId}: ${sameLaw.why}`);

    // The replacement takes over the old text's place in the version chain.
    await client.query(
      `UPDATE legal_sources SET is_current_version = $2, supersedes = COALESCE(supersedes, $3), amendment_of = COALESCE(amendment_of, $4), updated_at = now()
        WHERE id = $1`,
      [newId, oldRow.is_current_version, oldRow.supersedes, oldRow.amendment_of]
    );
    // Anything that pointed at the damaged text now points at its replacement.
    await client.query(`UPDATE legal_sources SET supersedes = $2 WHERE supersedes = $1 AND id <> $2`, [oldId, newId]);
    await client.query(`UPDATE legal_sources SET amendment_of = $2 WHERE amendment_of = $1 AND id <> $2`, [oldId, newId]);
    await client.query(`UPDATE legal_sources SET is_current_version = false WHERE id = $1`, [oldId]);
    await applyChange(client, oldId, "replaced", { ...change, reason: `${change.reason} (replaced by source ${newId})` }, newId);
    await client.query(
      `INSERT INTO corpus_integrity_events (source_id, from_status, to_status, actor, reason, evidence)
       VALUES ($1, $2, $2, $3, $4, $5)`,
      [newId, newRow.integrity_status, change.actor, `replaces source ${oldId}: ${change.reason}`, change.evidence ?? null]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Same law: same number and year when both titles carry them; else the same name before "رقم". */
export function sameLawIdentity(
  oldTitle: string,
  newTitle: string,
  oldNumber: string | null = null,
  newNumber: string | null = null
): { ok: boolean; why?: string } {
  const cite = (t: string) => {
    const f = t.replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
    const n = f.match(/رقم\s*\(?\s*(\d{1,4})/)?.[1];
    const y = f.match(/(?:لسنه|سنه|لعام|عام)\s*\(?\s*(\d{4})/)?.[1];
    const name = f.split(/\s+رقم\s+/)[0].replace(/\s+وتعديلاته$/, "").trim();
    return { n: n ? String(Number(n)) : null, y, name };
  };
  const a = cite(oldTitle);
  const b = cite(newTitle);
  const na = oldNumber ?? a.n;
  const nb = newNumber ?? b.n;
  if (na && nb && String(Number(na)) !== String(Number(nb))) return { ok: false, why: `law number ${na} vs ${nb}` };
  if (a.y && b.y && a.y !== b.y) return { ok: false, why: `year ${a.y} vs ${b.y}` };
  if (!(na && nb) && a.name !== b.name) return { ok: false, why: `"${a.name}" vs "${b.name}"` };
  return { ok: true };
}
