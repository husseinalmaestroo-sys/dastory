import "server-only";
import { getPool } from "../db";
import { normalizeDigits } from "../ingest/clean";

/**
 * Corpus integrity and authority (Phase 2.1, separated in the 2026-10 corpus
 * repair).
 *
 * A source's text is only as good as its extraction: Gazette PDFs with broken
 * font maps yield fluent-looking garbage (ingest/quality.ts), a scanned law
 * loses its article numbering, a download can be the wrong law or truncated.
 *
 * Five facts about a source are recorded SEPARATELY (db/schema.sql), and none
 * is ever inferred from another:
 *
 *   provenance        where the text came from: 'official' (the publisher that
 *                     issues it — Legislation Bureau, Official Gazette,
 *                     Judicial Council), 'secondary' (a republication), NULL
 *                     (not recorded)
 *   integrity_status  whether the stored TEXT passed the integrity checks:
 *                       unchecked    never checked — NEVER served (the default)
 *                       passed       passed the checks — served
 *                       quarantined  damaged or suspect — NEVER served, kept
 *                       replaced     replaced by a repaired re-ingest — NEVER served, kept
 *   gazette_status    whether the text was compared with the Official Gazette
 *                     ('verified', with the reference and who compared it) —
 *                     an official source is NOT thereby Gazette-verified, and
 *                     a secondary republication can still be verified later
 *   version           is_current_version / effective_date / supersedes
 *   authority         derived, never stored: see isAuthoritative
 *
 * Every change is an append-only event (corpus_integrity_events, with its
 * kind): who, when, from what to what, why, and against which evidence.
 */

export const INTEGRITY_STATUSES = ["unchecked", "passed", "quarantined", "replaced"] as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number];

/** The only integrity state retrieval may serve. */
export const SERVABLE_INTEGRITY: readonly IntegrityStatus[] = ["passed"];
/** For SQL: `integrity_status IN (${SERVABLE_SQL})`. Literal on purpose — never user input. */
export const SERVABLE_SQL = SERVABLE_INTEGRITY.map((s) => `'${s}'`).join(", ");

export const GAZETTE_STATUSES = ["unverified", "verified"] as const;
export type GazetteStatus = (typeof GAZETTE_STATUSES)[number];

export function isIntegrityStatus(s: string): s is IntegrityStatus {
  return (INTEGRITY_STATUSES as readonly string[]).includes(s);
}

/**
 * The one definition of "a source retrieval may serve", as a SQL condition on
 * legal_sources (`alias.` prefix optional). Every path that can put a text in
 * front of a lawyer uses it: the ranked and exact search arms, the full-row
 * fetch (and getChunksByIds), law-title resolution, citation verification and
 * the corpus version. Never served:
 *   • a source that is not ready (failed, half-ingested);
 *   • a non-Jordanian source (retrieval is Jordan-only);
 *   • a synthetic fixture, unless ALLOW_SYNTHETIC_CORPUS (evaluation only) —
 *     `syntheticParam` is the SQL parameter carrying that flag;
 *   • any text whose integrity has not PASSED: unchecked, quarantined, replaced.
 * Version (a superseded text when the current one is required) is filtered by
 * the caller, which knows whether the question asks about the past.
 */
export function servableSourceSql(alias: string, syntheticParam: string): string {
  const a = alias ? `${alias}.` : "";
  return `${a}status = 'ready' AND ${a}jurisdiction = 'JO' AND (${a}is_synthetic = false OR ${syntheticParam}::boolean) AND ${a}integrity_status IN (${SERVABLE_SQL})`;
}

/** servableSourceSql for a row already in memory (the inventory, the repair manifest). Kept identical — a test compares them. */
export function isServableSource(
  s: { status: string; jurisdiction: string; is_synthetic: boolean; integrity_status: string },
  allowSynthetic: boolean
): boolean {
  return (
    s.status === "ready" &&
    s.jurisdiction === "JO" &&
    (!s.is_synthetic || allowSynthetic) &&
    (SERVABLE_INTEGRITY as readonly string[]).includes(s.integrity_status)
  );
}

type AuthorityFields = {
  provenance?: string | null;
  integrity_status?: string | null;
  gazette_status?: string | null;
  is_synthetic?: boolean | null;
};

/**
 * Whether a source may be presented as the authoritative text of the law: its
 * text was compared with the Official Gazette (with recorded evidence), it
 * passed the integrity checks, and it is not an evaluation fixture. Provenance
 * alone never makes a text authoritative — an official publisher's file can
 * still be the wrong version or a damaged extraction.
 */
export function isAuthoritative(s: AuthorityFields): boolean {
  return s.gazette_status === "verified" && s.integrity_status === "passed" && s.is_synthetic !== true;
}

/**
 * What can truthfully be said about a source's authority, from recorded facts
 * only (for labels: the UI must not say more than this).
 *   gazette_verified        compared with the Official Gazette (any provenance)
 *   official_not_verified   from the official publisher, not compared with the Gazette
 *   secondary_not_verified  a republication, not compared with the Gazette
 *   unrecorded_not_verified provenance not recorded, not compared
 *   synthetic               an evaluation fixture — never law
 */
export type AuthorityLevel = "gazette_verified" | "official_not_verified" | "secondary_not_verified" | "unrecorded_not_verified" | "synthetic";

export function authorityLevel(s: AuthorityFields): AuthorityLevel {
  if (s.is_synthetic === true || s.provenance === "synthetic") return "synthetic";
  if (isAuthoritative(s)) return "gazette_verified";
  if (s.provenance === "official") return "official_not_verified";
  if (s.provenance === "secondary") return "secondary_not_verified";
  return "unrecorded_not_verified";
}

export type IntegrityChange = {
  /** Who decided: an operator's name/email, or "corpus-integrity check (automatic)". */
  actor: string;
  reason: string;
  /** What the decision rests on — for Gazette verification, the Gazette reference (issue/page, URL or sha256). */
  evidence?: string | null;
};

export type EventKind = "integrity" | "gazette" | "metadata" | "classification" | "provenance";

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Appends one event to the audit log. */
export async function recordEvent(
  db: Queryable,
  sourceId: number,
  kind: EventKind,
  from: string | null,
  to: string,
  change: IntegrityChange
): Promise<void> {
  await db.query(
    `INSERT INTO corpus_integrity_events (source_id, kind, from_status, to_status, actor, reason, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sourceId, kind, from, to, change.actor, change.reason, change.evidence ?? null]
  );
}

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
  // gazette_status is deliberately left as it is: whether the text was ever
  // compared with the Gazette is a separate fact. A quarantined text is not
  // authoritative anyway — authority requires integrity 'passed'.
  await recordEvent(db, sourceId, "integrity", from, to, change);
  return from;
}

function requireReason(change: IntegrityChange): void {
  if (!change.actor?.trim()) throw new Error("A corpus change needs an actor (who decided).");
  if (!change.reason?.trim()) throw new Error("A corpus change needs a reason.");
}

async function inTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sets a source's integrity status, with an event. 'replaced' is set only
 * through replaceSource, which records the replacement. Marking a text
 * 'passed' by hand is a reviewer's decision and needs a reason like any other.
 */
export async function setIntegrity(sourceId: number, to: IntegrityStatus, change: IntegrityChange): Promise<{ from: IntegrityStatus; to: IntegrityStatus }> {
  requireReason(change);
  if (to === "replaced") throw new Error("Use replaceSource to mark a source replaced — it records the replacement.");
  if (!isIntegrityStatus(to)) throw new Error(`Unknown integrity status "${to}". One of: ${INTEGRITY_STATUSES.join(", ")}`);
  const from = await inTransaction((db) => applyChange(db, sourceId, to, change));
  return { from, to };
}

/**
 * Records whether a source's text was compared with the Official Gazette.
 * Verifying needs the reference compared against (issue/page, URL or file
 * hash) and is refused for a text that has not passed the integrity checks.
 * Provenance is not touched: a secondary republication stays secondary.
 */
export async function setGazetteStatus(
  sourceId: number,
  to: GazetteStatus,
  change: IntegrityChange
): Promise<{ from: GazetteStatus; to: GazetteStatus }> {
  requireReason(change);
  if (!(GAZETTE_STATUSES as readonly string[]).includes(to)) throw new Error(`Unknown Gazette status "${to}".`);
  if (to === "verified" && !change.evidence?.trim()) {
    throw new Error("Gazette verification needs evidence: the Official Gazette reference (issue and page, URL or file hash) the text was compared against.");
  }
  return inTransaction(async (db) => {
    const cur = await db.query(`SELECT integrity_status, gazette_status FROM legal_sources WHERE id = $1 FOR UPDATE`, [sourceId]);
    if (cur.rows.length === 0) throw new Error(`Source ${sourceId} does not exist.`);
    const from = String(cur.rows[0].gazette_status) as GazetteStatus;
    if (to === "verified" && cur.rows[0].integrity_status !== "passed") {
      throw new Error(`Source ${sourceId} is ${cur.rows[0].integrity_status}: only a text that passed the integrity checks can be Gazette-verified.`);
    }
    await db.query(
      `UPDATE legal_sources
          SET gazette_status = $2,
              gazette_reference = CASE WHEN $2 = 'verified' THEN $3 ELSE NULL END,
              gazette_verified_by = CASE WHEN $2 = 'verified' THEN $4 ELSE NULL END,
              gazette_verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [sourceId, to, change.evidence ?? null, change.actor]
    );
    await recordEvent(db, sourceId, "gazette", from, to, change);
    return { from, to };
  });
}

/**
 * A repaired re-ingest takes a damaged source's place: the new source inherits
 * the old one's legal-version position (current / superseded / amendment
 * links), the old one becomes 'replaced' (kept, never served) with a pointer to
 * its replacement. Both sides are logged. The new source must already be
 * ingested, must have PASSED the integrity checks, and must be the same law
 * (same number and year, when the titles carry them).
 */
export async function replaceSource(oldId: number, newId: number, change: IntegrityChange): Promise<void> {
  requireReason(change);
  if (oldId === newId) throw new Error("A source cannot replace itself.");
  await inTransaction(async (client) => {
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
    if (newRow.integrity_status !== "passed") {
      throw new Error(`Replacement source ${newId} is ${newRow.integrity_status}; it must pass the integrity checks first (npm run corpus:integrity -- check --apply).`);
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
    await recordEvent(client, newId, "integrity", String(newRow.integrity_status), String(newRow.integrity_status), {
      ...change,
      reason: `replaces source ${oldId}: ${change.reason}`,
    });
  });
}

/** Same law: same number and year when both titles carry them; else the same name before "رقم". */
export function sameLawIdentity(
  oldTitle: string,
  newTitle: string,
  oldNumber: string | null = null,
  newNumber: string | null = null
): { ok: boolean; why?: string } {
  const cite = (t: string) => {
    // Digits first: the harakat range must not meet Arabic-Indic digits.
    const f = normalizeDigits(t).replace(/[\u0640\u064B-\u065F\u0670]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
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
