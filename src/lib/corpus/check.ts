import "server-only";
import { getPool } from "../db";
import { assessArabicText } from "../ingest/quality";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { normalizeTitle } from "../ingest/title";
import { isIntegrityStatus, recordEvent, type IntegrityStatus } from "./integrity";

/**
 * The integrity check (corpus repair, 2026-10). A source is served only after
 * it has PASSED this check (or a reviewer's decision): nothing is served
 * because nobody looked. The same rules run in three places — at the end of
 * every ingest (ingest/pipeline.ts), over the database on demand
 * (`npm run corpus:integrity -- check`), and in the inventory's anomalies — so
 * a text is never judged by two standards.
 *
 * Quarantined (never served, kept):
 *   • empty_source    no chunks at all
 *   • garbled_text    the WHOLE text fails the mojibake test (ingest/quality.ts:
 *                     too few common Arabic words, or shredded into loose letters)
 *   • garbled_chunks  more than a tenth of its sizeable chunks are unreadable on
 *                     their own — a document can be clean on average and still
 *                     carry whole garbled pages
 *   • article_gaps    a statute missing more than a fifth of its article numbers
 *                     up to the highest — its citations cannot be trusted. A
 *                     source holding one PART of a law ("الدستور الأردني -
 *                     الفصل05") is measured from its own first article: the
 *                     earlier ones are in the other parts, not missing.
 * Reported, not quarantined: a few garbled chunks, smaller numbering gaps.
 *
 * Judged on the full text, not a sample: the inventory used to read the first
 * 12,000 characters, which a law garbled from page 30 on passes.
 */

const STATUTE_TYPES = new Set(["law", "regulation", "instruction"]);
/** A chunk shorter than this (Arabic characters) is not judged on its own. */
const CHUNK_MIN_ARABIC = 600;
/** Share of sizeable chunks that may be unreadable before the whole source is quarantined. */
const MAX_GARBLED_CHUNK_SHARE = 0.1;
/** Share of article numbers (up to the highest) that may be missing in a statute. */
const MAX_MISSING_ARTICLE_RATIO = 0.2;

export type IntegrityFindingKind = "empty_source" | "garbled_text" | "garbled_chunks" | "article_gaps";
export type IntegrityFinding = { kind: IntegrityFindingKind; blocking: boolean; detail: string };
export type IntegrityVerdict = { verdict: "passed" | "quarantined"; findings: IntegrityFinding[] };

const LEADING_INT = /^\s*(\d{1,5})/;

/**
 * A source that holds one part of a law — a chapter, part or section file
 * ("الدستور الأردني - الفصل05", "… الباب الثاني"): the Constitution is
 * published as ten chapter files (deploy/sources/moj-constitution-ar.txt).
 */
export function isPartOfLaw(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = foldForSearch(normalizeTitle(title));
  return /(?:^|[\s\-–—])(?:ال)?(?:فصل|باب|جزء|قسم)\s*(?:\d|ال(?:اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر))/.test(t);
}

/**
 * Distinct article numbers present, and the share missing up to the highest
 * (with at least 3 numbered) — counted from article 1, or, for one part of a
 * law, from its own lowest article.
 */
export function missingArticleRatio(articles: (string | null)[], opts: { fromLowest?: boolean } = {}): { distinct: number; missingRatio: number; firstGaps: number[] } {
  const ints = new Set<number>();
  for (const a of articles) {
    const m = a ? LEADING_INT.exec(normalizeDigits(a)) : null;
    if (m) ints.add(Number(m[1]));
  }
  if (ints.size < 3) return { distinct: ints.size, missingRatio: 0, firstGaps: [] };
  const max = Math.max(...ints);
  const min = opts.fromLowest ? Math.min(...ints) : 1;
  const gaps: number[] = [];
  for (let n = min; n <= max; n++) if (!ints.has(n)) gaps.push(n);
  return { distinct: ints.size, missingRatio: gaps.length / (max - min + 1), firstGaps: gaps.slice(0, 10) };
}

/** A chunk unreadable on its own: almost no common Arabic words, or shredded into loose letters. */
export function isGarbledChunk(text: string): boolean {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  if (arabic < CHUNK_MIN_ARABIC) return false;
  const q = assessArabicText(text);
  return q.distinctCommonWords <= 1 || q.orphanLetterRatio > 0.12;
}

export function integrityVerdict(input: {
  sourceType: string;
  isSynthetic: boolean;
  chunkTexts: string[];
  articles: (string | null)[];
  /** The source's title: a part of a law is measured from its own first article. */
  title?: string | null;
}): IntegrityVerdict {
  const findings: IntegrityFinding[] = [];
  if (input.chunkTexts.length === 0) {
    return { verdict: "quarantined", findings: [{ kind: "empty_source", blocking: true, detail: "no chunks" }] };
  }

  const whole = assessArabicText(input.chunkTexts.join("\n"));
  if (whole.garbled) findings.push({ kind: "garbled_text", blocking: true, detail: whole.reason ?? "garbled" });

  const sizeable = input.chunkTexts.filter((t) => (t.match(/[؀-ۿ]/g) ?? []).length >= CHUNK_MIN_ARABIC);
  const garbled = sizeable.filter(isGarbledChunk).length;
  if (garbled > 0) {
    const share = garbled / sizeable.length;
    findings.push({
      kind: "garbled_chunks",
      blocking: share > MAX_GARBLED_CHUNK_SHARE,
      detail: `${garbled} of ${sizeable.length} sizeable chunks are unreadable (${Math.round(share * 100)}%; quarantined above ${MAX_GARBLED_CHUNK_SHARE * 100}%)`,
    });
  }

  if (STATUTE_TYPES.has(input.sourceType) && !input.isSynthetic) {
    const seq = missingArticleRatio(input.articles, { fromLowest: isPartOfLaw(input.title) });
    if (seq.missingRatio > 0) {
      findings.push({
        kind: "article_gaps",
        blocking: seq.missingRatio > MAX_MISSING_ARTICLE_RATIO,
        detail: `${Math.round(seq.missingRatio * 100)}% of article numbers up to the highest are absent (first: ${seq.firstGaps.join(", ")})`,
      });
    }
  }

  return { verdict: findings.some((f) => f.blocking) ? "quarantined" : "passed", findings };
}

export type CheckPlanRow = {
  sourceId: number;
  title: string;
  from: IntegrityStatus;
  to: IntegrityStatus;
  findings: IntegrityFinding[];
};

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * Checks sources and records the result. By default only 'unchecked' sources
 * are judged (the state every source starts in); `recheck` judges 'passed'
 * ones again. A quarantined or replaced source is never moved by an automatic
 * check — only a reviewer can bring it back. With apply=false nothing changes.
 */
export async function runIntegrityCheck(opts: {
  apply: boolean;
  actor?: string;
  recheck?: boolean;
  /** Only quarantine (never move unchecked → passed): the old auto-quarantine. */
  quarantineOnly?: boolean;
  sourceIds?: number[];
}): Promise<CheckPlanRow[]> {
  const db = getPool();
  const statuses = opts.recheck ? ["unchecked", "passed"] : ["unchecked"];
  const sources = (
    await db.query(
      `SELECT id, title, source_type, is_synthetic, integrity_status FROM legal_sources
        WHERE status = 'ready' AND integrity_status = ANY($1::text[])
          AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))
        ORDER BY id`,
      [statuses, opts.sourceIds ?? null]
    )
  ).rows;
  const plan: CheckPlanRow[] = [];
  for (const s of sources) {
    const sourceId = Number(s.id);
    const chunks = (
      await db.query(`SELECT chunk_text, article_number FROM legal_documents WHERE source_id = $1 ORDER BY chunk_index`, [sourceId])
    ).rows;
    const v = integrityVerdict({
      sourceType: String(s.source_type),
      title: String(s.title),
      isSynthetic: s.is_synthetic === true,
      chunkTexts: chunks.map((c) => String(c.chunk_text ?? "")),
      articles: chunks.map((c) => (c.article_number === null ? null : String(c.article_number))),
    });
    const from = String(s.integrity_status) as IntegrityStatus;
    if (opts.quarantineOnly && v.verdict !== "quarantined") continue;
    if (v.verdict === from) continue;
    plan.push({ sourceId, title: String(s.title), from, to: v.verdict, findings: v.findings });
  }
  if (opts.apply) {
    for (const p of plan) await applyVerdict(db, p.sourceId, p.from, p.to, p.findings, opts.actor ?? "corpus-integrity check (automatic)");
  }
  return plan;
}

/** Records one check result, unless the status changed meanwhile (then nothing is written). */
export async function applyVerdict(db: Q, sourceId: number, from: IntegrityStatus, to: IntegrityStatus, findings: IntegrityFinding[], actor: string): Promise<boolean> {
  if (!isIntegrityStatus(to)) throw new Error(`Unknown integrity status ${to}`);
  const reason =
    to === "passed"
      ? `automatic integrity check passed${findings.length ? ` (noted: ${findings.map((f) => `${f.kind}: ${f.detail}`).join(" | ")})` : ""}`
      : `automatic integrity check failed: ${findings.filter((f) => f.blocking).map((f) => `${f.kind}: ${f.detail}`).join(" | ")}`;
  const res = await db.query(
    `UPDATE legal_sources SET integrity_status = $3, integrity_note = $4, integrity_checked_at = now(), updated_at = now()
      WHERE id = $1 AND integrity_status = $2 RETURNING id`,
    [sourceId, from, to, `${reason} (${actor})`]
  );
  if (res.rows.length === 0) return false;
  await recordEvent(db, sourceId, "integrity", from, to, { actor, reason });
  return true;
}
