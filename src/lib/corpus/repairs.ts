import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool, transaction } from "../db";
import { foldForSearch } from "../ingest/clean";
import { SOURCE_TYPES } from "../ingest/classify";
import { normalizeTitle } from "../ingest/title";
import { isServableSource, recordEvent, type IntegrityChange } from "./integrity";

/**
 * The known-defect repair manifest (corpus repair, 2026-10):
 * deploy/sources/corpus-repairs.json lists the defects of the production
 * corpus that this repository RECORDS — the corrupted Civil Code, the old
 * corrupted Penal Code, provenance the bulk ingest never stored, a damaged
 * title, memoranda filed as instructions — and the safe repair for each.
 *
 * Safe by construction:
 *   • an entry naming a source id touches that row only if its title matches
 *     too; otherwise it is a `mismatch` and nothing changes;
 *   • an entry matching by title touches at most `maxMatches` rows (default 1);
 *     more is `too_many` and nothing changes;
 *   • no action adds legal text, a law number or a year; a damaged text is
 *     quarantined (kept, never served), never rewritten;
 *   • a recorded provenance is never overwritten (`conflict`), and Gazette
 *     verification is never set here — it needs a reviewer and a reference;
 *   • synthetic rows (evaluation fixtures) are never touched;
 *   • every change is an event with actor `repair-manifest:<id>`; with
 *     apply=false nothing is written.
 *
 * planRepairs is pure (unit-tested); applyRepairs reads and writes the DB.
 */

export const DEFAULT_REPAIRS_PATH = "deploy/sources/corpus-repairs.json";

export const REPAIR_ACTIONS = ["quarantine", "set_provenance", "retitle", "reclassify", "review"] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

export type RepairMatch = {
  sourceId?: number;
  titleEquals?: string;
  titleStartsWith?: string;
  titleIncludesAll?: string[];
  filePathIncludes?: string;
  noteIncludes?: string;
  sourceType?: string[];
  /** For a match without sourceId: the most rows it may touch (default 1). */
  maxMatches?: number;
};

export type RepairEntry = {
  id: string;
  action: RepairAction;
  match: RepairMatch;
  params?: { provenance?: string; authority?: string; title?: string; sourceType?: string };
  /** The defect blocks a live run (and launch) while its target can still be served. Quarantine entries only. */
  launchBlocker?: boolean;
  reason: string;
  evidence: string;
};

export type RepairManifest = { repairs: RepairEntry[] };

const SELECTORS: (keyof RepairMatch)[] = ["sourceId", "titleEquals", "titleStartsWith", "titleIncludesAll", "filePathIncludes", "noteIncludes"];
const TITLE_PREDICATES: (keyof RepairMatch)[] = ["titleEquals", "titleStartsWith", "titleIncludesAll"];

/** Every problem with a manifest (empty when valid). Checked on load: a malformed entry never runs. */
export function validateRepairManifest(m: unknown): string[] {
  const errors: string[] = [];
  const repairs = (m as RepairManifest | null)?.repairs;
  if (!Array.isArray(repairs)) return ["`repairs` must be an array"];
  const ids = new Set<string>();
  repairs.forEach((e, i) => {
    const at = `repairs[${i}]${e?.id ? ` (${e.id})` : ""}`;
    if (!e || typeof e !== "object") return void errors.push(`${at}: not an object`);
    if (!e.id?.trim()) errors.push(`${at}: id is required`);
    else if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    else ids.add(e.id);
    if (!(REPAIR_ACTIONS as readonly string[]).includes(e.action)) errors.push(`${at}: unknown action "${e.action}"`);
    if (!e.reason?.trim()) errors.push(`${at}: reason is required`);
    if (!e.evidence?.trim()) errors.push(`${at}: evidence is required — the repository record the entry rests on`);
    const match = e.match ?? {};
    if (!SELECTORS.some((k) => match[k] !== undefined)) errors.push(`${at}: match needs a selector (${SELECTORS.join(", ")})`);
    if (match.sourceId !== undefined && !TITLE_PREDICATES.some((k) => match[k] !== undefined)) {
      errors.push(`${at}: a sourceId match must also check the title (an id alone could name another law in another database)`);
    }
    if (match.sourceId !== undefined && (!Number.isInteger(match.sourceId) || match.sourceId <= 0)) errors.push(`${at}: sourceId must be a positive integer`);
    if (match.maxMatches !== undefined && (!Number.isInteger(match.maxMatches) || match.maxMatches < 1)) errors.push(`${at}: maxMatches must be ≥ 1`);
    for (const t of match.sourceType ?? []) if (!(SOURCE_TYPES as string[]).includes(t)) errors.push(`${at}: unknown sourceType "${t}"`);
    const p = e.params ?? {};
    if (e.action === "set_provenance") {
      // 'synthetic' is never set on a production row from here; and a Gazette
      // claim is not a provenance.
      if (p.provenance !== "official" && p.provenance !== "secondary") errors.push(`${at}: set_provenance needs params.provenance 'official' or 'secondary'`);
    }
    if (e.action === "retitle" && !p.title?.trim()) errors.push(`${at}: retitle needs params.title`);
    if (e.action === "retitle" && p.title && /\d/.test(normalizeTitle(p.title)) && !/\d/.test(String(match.titleEquals ?? match.titleStartsWith ?? ""))) {
      errors.push(`${at}: retitle may not introduce a number the matched title does not carry (no invented law number or year)`);
    }
    if (e.action === "reclassify" && !(SOURCE_TYPES as string[]).includes(String(p.sourceType))) errors.push(`${at}: reclassify needs a valid params.sourceType`);
    if (e.launchBlocker && e.action !== "quarantine") errors.push(`${at}: only a quarantine entry can be a launch blocker`);
  });
  return errors;
}

export function loadRepairManifest(path = DEFAULT_REPAIRS_PATH): RepairManifest {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as RepairManifest;
  const errors = validateRepairManifest(raw);
  if (errors.length > 0) throw new Error(`Invalid repair manifest ${path}:\n  ${errors.join("\n  ")}`);
  return raw;
}

export type RepairSourceRow = {
  id: number;
  title: string;
  source_type: string;
  file_path: string | null;
  note: string | null;
  provenance: string | null;
  integrity_status: string;
  status: string;
  jurisdiction: string;
  is_synthetic: boolean;
};

/** Titles compared folded: tatweel, diacritics, hamza seats and digit forms never decide a match. */
const fold = (s: string) => foldForSearch(normalizeTitle(s)).replace(/\s+/g, " ").trim();

/** Whether a row satisfies every predicate of a match (the id is checked by the caller). */
export function matchesRepair(row: RepairSourceRow, m: RepairMatch, extraTypes: string[] = []): boolean {
  const t = fold(row.title);
  if (m.titleEquals !== undefined && t !== fold(m.titleEquals)) return false;
  if (m.titleStartsWith !== undefined && !t.startsWith(fold(m.titleStartsWith))) return false;
  if (m.titleIncludesAll && !m.titleIncludesAll.every((n) => t.includes(fold(n)))) return false;
  if (m.filePathIncludes !== undefined && !(row.file_path ?? "").includes(m.filePathIncludes)) return false;
  if (m.noteIncludes !== undefined && !(row.note ?? "").includes(m.noteIncludes)) return false;
  if (m.sourceType && ![...m.sourceType, ...extraTypes].includes(row.source_type)) return false;
  return true;
}

/**
 *   apply      would change the row (dry run) — `applied` once written
 *   already    the row is already in the repaired state (or the event log shows the repair was applied)
 *   not_found  no row in this database matches (not a defect of this database)
 *   mismatch   the named id holds another text — nothing changes; inspect
 *   too_many   more rows match than the entry allows — nothing changes
 *   conflict   a recorded value differs (never overwritten), or the row changed meanwhile
 *   review     a reviewer's task; never automatic
 */
export type RepairOutcome = "apply" | "applied" | "already" | "not_found" | "mismatch" | "too_many" | "conflict" | "review";

export type RepairPlanRow = {
  id: string;
  action: RepairAction;
  sourceId: number | null;
  title: string | null;
  outcome: RepairOutcome;
  from: string | null;
  to: string | null;
  detail: string;
};

/** (repair id, source id) pairs the event log shows were applied before. */
export type AppliedRepair = { repairId: string; sourceId: number };

function evaluate(e: RepairEntry, row: RepairSourceRow): RepairPlanRow {
  const base = { id: e.id, action: e.action, sourceId: row.id, title: row.title };
  const p = e.params ?? {};
  switch (e.action) {
    case "quarantine":
      if (row.integrity_status === "quarantined" || row.integrity_status === "replaced") {
        return { ...base, outcome: "already", from: row.integrity_status, to: row.integrity_status, detail: `already ${row.integrity_status} — not served` };
      }
      return { ...base, outcome: "apply", from: row.integrity_status, to: "quarantined", detail: e.reason };
    case "set_provenance":
      if (row.provenance === p.provenance) return { ...base, outcome: "already", from: row.provenance, to: row.provenance, detail: "provenance already recorded" };
      if (row.provenance !== null) {
        return {
          ...base,
          outcome: "conflict",
          from: row.provenance,
          to: p.provenance ?? null,
          detail: `provenance already recorded as '${row.provenance}'; a recorded value is never overwritten here — review by hand`,
        };
      }
      return { ...base, outcome: "apply", from: null, to: p.provenance ?? null, detail: p.authority ? `${p.provenance} — ${p.authority}` : String(p.provenance) };
    case "retitle": {
      const want = normalizeTitle(String(p.title));
      if (row.title === want) return { ...base, outcome: "already", from: row.title, to: want, detail: "title already repaired" };
      return { ...base, outcome: "apply", from: row.title, to: want, detail: e.reason };
    }
    case "reclassify":
      if (row.source_type === p.sourceType) return { ...base, outcome: "already", from: row.source_type, to: row.source_type, detail: "already reclassified" };
      return { ...base, outcome: "apply", from: row.source_type, to: String(p.sourceType), detail: e.reason };
    case "review":
      return { ...base, outcome: "review", from: null, to: null, detail: e.reason };
  }
}

/**
 * What applying the manifest to these rows would do. Synthetic rows are never
 * candidates. Pure: decides, writes nothing.
 */
export function planRepairs(manifest: RepairManifest, rows: RepairSourceRow[], applied: AppliedRepair[] = []): RepairPlanRow[] {
  const real = rows.filter((r) => !r.is_synthetic);
  const out: RepairPlanRow[] = [];
  for (const e of manifest.repairs) {
    const m = e.match;
    const appliedTo = applied.filter((a) => a.repairId === e.id).map((a) => a.sourceId);
    const nothing = (outcome: RepairOutcome, detail: string, sourceId: number | null = null, title: string | null = null) =>
      out.push({ id: e.id, action: e.action, sourceId, title, outcome, from: null, to: null, detail });

    let targets: RepairSourceRow[];
    if (m.sourceId !== undefined) {
      const row = real.find((r) => r.id === m.sourceId);
      if (!row) {
        nothing(appliedTo.length ? "already" : "not_found", appliedTo.length ? "applied earlier (event log)" : `no source ${m.sourceId} in this database`, m.sourceId);
        continue;
      }
      if (!matchesRepair(row, m, e.action === "reclassify" && e.params?.sourceType ? [e.params.sourceType] : [])) {
        if (appliedTo.includes(row.id)) {
          nothing("already", "applied earlier (event log)", row.id, row.title);
          continue;
        }
        nothing("mismatch", `source ${row.id} is "${row.title}" (${row.source_type}), not the text this entry names — nothing changed; inspect and correct the manifest`, row.id, row.title);
        continue;
      }
      targets = [row];
    } else {
      // A reclassified row still counts as this entry's target (reported as already).
      targets = real.filter((r) => matchesRepair(r, m, e.action === "reclassify" && e.params?.sourceType ? [e.params.sourceType] : []));
      const max = m.maxMatches ?? 1;
      if (targets.length === 0) {
        nothing(appliedTo.length ? "already" : "not_found", appliedTo.length ? `applied earlier to source(s) ${appliedTo.join(", ")} (event log)` : "no source in this database matches");
        continue;
      }
      if (targets.length > max) {
        nothing("too_many", `${targets.length} sources match (ids ${targets.map((t) => t.id).slice(0, 12).join(", ")}${targets.length > 12 ? " …" : ""}); at most ${max} allowed — nothing changed`);
        continue;
      }
    }
    for (const row of targets) out.push(evaluate(e, row));
  }
  return out;
}

/**
 * Launch-blocking defects still in reach of retrieval: for every entry marked
 * launchBlocker, its target is servable, or cannot be confirmed (the named id
 * holds another text, or too many rows match). A target that is quarantined,
 * replaced or absent from this database blocks nothing.
 */
export function servingBlockers(
  manifest: RepairManifest,
  rows: RepairSourceRow[],
  applied: AppliedRepair[] = [],
  allowSynthetic = false
): { id: string; sourceId: number | null; detail: string }[] {
  const blockers: { id: string; sourceId: number | null; detail: string }[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const entries = manifest.repairs.filter((e) => e.launchBlocker);
  for (const p of planRepairs({ repairs: entries }, rows, applied)) {
    if (p.outcome === "mismatch" || p.outcome === "too_many") {
      blockers.push({ id: p.id, sourceId: p.sourceId, detail: `cannot confirm the defect is contained: ${p.detail}` });
      continue;
    }
    const row = p.sourceId === null ? undefined : byId.get(p.sourceId);
    if (row && isServableSource(row, allowSynthetic)) {
      blockers.push({ id: p.id, sourceId: row.id, detail: `source ${row.id} "${row.title}" is still servable (integrity ${row.integrity_status})` });
    }
  }
  return blockers;
}

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export async function loadRepairRows(db: Q): Promise<{ rows: RepairSourceRow[]; applied: AppliedRepair[] }> {
  const rows = (
    await db.query(
      `SELECT id, title, source_type, file_path, note, provenance, integrity_status, status, jurisdiction, is_synthetic
         FROM legal_sources WHERE is_synthetic = false ORDER BY id`
    )
  ).rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    source_type: String(r.source_type),
    file_path: (r.file_path as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    provenance: (r.provenance as string | null) ?? null,
    integrity_status: String(r.integrity_status),
    status: String(r.status),
    jurisdiction: String(r.jurisdiction),
    is_synthetic: r.is_synthetic === true,
  }));
  const applied = (
    await db.query(`SELECT DISTINCT actor, source_id FROM corpus_integrity_events WHERE actor LIKE 'repair-manifest:%'`)
  ).rows.map((r) => ({ repairId: String(r.actor).slice("repair-manifest:".length), sourceId: Number(r.source_id) }));
  return { rows, applied };
}

/** Writes one planned change, conditional on the row still being as planned. False when it changed meanwhile. */
async function applyOne(e: RepairEntry, p: RepairPlanRow): Promise<boolean> {
  const id = p.sourceId as number;
  const change: IntegrityChange = { actor: `repair-manifest:${e.id}`, reason: e.reason, evidence: e.evidence };
  return transaction(async (db) => {
    switch (e.action) {
      case "quarantine": {
        const r = await db.query(
          `UPDATE legal_sources SET integrity_status = 'quarantined', integrity_note = $3, integrity_checked_at = now(), updated_at = now()
            WHERE id = $1 AND integrity_status = $2 RETURNING id`,
          [id, p.from, `${e.reason} (repair-manifest:${e.id})`]
        );
        if (r.rows.length === 0) return false;
        await recordEvent(db, id, "integrity", p.from, "quarantined", change);
        return true;
      }
      case "set_provenance": {
        const r = await db.query(
          `UPDATE legal_sources SET provenance = $2, issuing_authority = COALESCE(issuing_authority, $3),
                  acquired_at = COALESCE(acquired_at, created_at), updated_at = now()
            WHERE id = $1 AND provenance IS NULL RETURNING id`,
          [id, e.params?.provenance, e.params?.authority ?? null]
        );
        if (r.rows.length === 0) return false;
        await recordEvent(db, id, "provenance", null, String(e.params?.provenance), change);
        return true;
      }
      case "retitle": {
        const r = await db.query(`UPDATE legal_sources SET title = $3, updated_at = now() WHERE id = $1 AND title = $2 RETURNING id`, [id, p.from, p.to]);
        if (r.rows.length === 0) return false;
        // The name is denormalised onto each chunk (it labels the citation card).
        await db.query(`UPDATE legal_documents SET law_name = $3 WHERE source_id = $1 AND law_name = $2`, [id, p.from, p.to]);
        await recordEvent(db, id, "metadata", p.from, String(p.to), change);
        return true;
      }
      case "reclassify": {
        const r = await db.query(`UPDATE legal_sources SET source_type = $3, updated_at = now() WHERE id = $1 AND source_type = $2 RETURNING id`, [id, p.from, p.to]);
        if (r.rows.length === 0) return false;
        await recordEvent(db, id, "classification", p.from, String(p.to), change);
        return true;
      }
      case "review":
        return false;
    }
  });
}

/**
 * Plans the manifest against the configured database and, with apply=true,
 * writes every `apply` row (each in its own transaction, conditional on the
 * row being unchanged). Returns the plan with the outcomes as written.
 */
export async function applyRepairs(opts: { apply: boolean; manifest?: RepairManifest; manifestPath?: string; only?: string[] }): Promise<RepairPlanRow[]> {
  const manifest = opts.manifest ?? loadRepairManifest(opts.manifestPath);
  const entries = opts.only ? manifest.repairs.filter((e) => opts.only?.includes(e.id)) : manifest.repairs;
  const { rows, applied } = await loadRepairRows(getPool());
  const plan = planRepairs({ repairs: entries }, rows, applied);
  if (!opts.apply) return plan;
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const p of plan) {
    if (p.outcome !== "apply") continue;
    if (await applyOne(byId.get(p.id) as RepairEntry, p)) p.outcome = "applied";
    else {
      p.outcome = "conflict";
      p.detail = "the source changed since it was read; nothing written — run again";
    }
  }
  return plan;
}
