import "server-only";
import { query } from "../db";
import { normalizeDigits } from "../ingest/clean";
import { REDACTION } from "./guard";

/**
 * DB-verification for citations inside a GPT-generated (not retrieval-grounded)
 * answer — the Type-2 "hybrid" supplement in `route.ts`.
 *
 * WHY THIS EXISTS ALONGSIDE guard.ts, NOT INSTEAD OF IT
 *
 * `guard.ts`'s `redactCitations()` is a blind strip: anything citation-shaped in
 * an ungrounded answer is removed, no DB lookup involved, because for Type 3
 * (zero sources retrieved for this question at all) there is nothing to check
 * a citation *against* — the corpus has no opinion on this topic. That stays
 * exactly as-is and keeps serving Type 3 and gap-fill.
 *
 * Here, real sources WERE retrieved for this question (Type 2: low confidence,
 * not zero results), so a citation GPT writes in its supplementary reasoning is
 * checkable — either it names a law/article/decision that is actually in the
 * corpus, or it doesn't. This module extracts each citation-shaped span with
 * enough structure to look it up, keeps it verbatim if the DB confirms it, and
 * redacts it (same visible marker as guard.ts, for one consistent signal across
 * the app) if the DB has no record of it.
 *
 * An article number with no associated law nearby is NOT verified even if that
 * number happens to exist somewhere in the corpus — "المادة 5" exists in dozens
 * of unrelated laws, so a bare number without a law to scope it is exactly the
 * "not certain" case the spec says must be omitted, not guessed at.
 *
 * Court names are deliberately not verified here: Jordan has a fixed, small set
 * of court names (see COURTS in intent.ts/types.ts) and GPT reusing a real one
 * incorrectly is not the failure mode this guards against — a fabricated
 * DECISION NUMBER attributed to a real court is, and that IS covered below.
 */

const WINDOW = 200;

/** "قانون العمل رقم 8 لسنة 1996" — captures the law number and, if present, the year. */
const LAW_RE =
  /(?:قانون|نظام|تعليمات)(?:\s+(?:معدل|ال[؀-ۿ]+|[؀-ۿ]+)){0,5}\s+رقم\s*[({[]?\s*(\d+)[)}\]]?(?:\s*لسنة\s*(\d{4}))?/g;

/** "المادة 780" / "مادة (5)" / "م. 12" — captures the article number. */
const ARTICLE_RE = /(?:ال)?ماد[ةه]\s*[({[]?\s*(\d+)[)}\]]?|(?<![؀-ۿ])م\s*\.\s*(\d+)/g;

/** "قرار رقم 55 لسنة 2019" / bare "1234/2020" — captures decision number + year. */
const DECISION_RE =
  /(?:قرار|حكم|طعن|تمييز)\s*(?:رقم\s*)?[({[]?\s*(\d{1,6})\s*[/\-]\s*(\d{4})|(?:رقم\s*)?(\d{1,6})\s*\/\s*((?:19|20)\d{2})/g;

/** A bare "لسنة 1996" with no owning citation nearby — dangling, so unverifiable. */
const YEAR_RE = /لسنة\s*[({[]?\s*(?:19|20)\d{2}[)}\]]?/g;

type Span = { start: number; end: number; raw: string; verified: boolean };
type LawSpan = Span & { lawNumber: string };

async function verifyLaw(lawNumber: string, year: number | null): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM legal_sources WHERE law_number = $1 AND ($2::int IS NULL OR year = $2) LIMIT 1`,
    [lawNumber, year]
  );
  return rows.length > 0;
}

async function verifyDecision(decisionNumber: string, year: number | null): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM legal_documents WHERE decision_number = $1 AND ($2::int IS NULL OR year = $2) LIMIT 1`,
    [decisionNumber, year]
  );
  return rows.length > 0;
}

async function verifyArticleInLaw(articleNumber: string, lawNumber: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM legal_documents WHERE article_number = $1 AND law_number = $2 LIMIT 1`,
    [articleNumber, lawNumber]
  );
  return rows.length > 0;
}

async function findLawSpans(text: string): Promise<LawSpan[]> {
  // Each match verifies against the DB independently of the others, so this
  // fans the round-trips out concurrently instead of paying N sequential
  // round-trips one at a time — matchAll already yields left-to-right order,
  // and Promise.all preserves the input array's order regardless of which
  // query resolves first, so downstream ordering is unaffected.
  const matches = [...text.matchAll(LAW_RE)];
  return Promise.all(
    matches.map(async (m) => {
      const lawNumber = m[1];
      const year = m[2] ? Number(m[2]) : null;
      const verified = await verifyLaw(lawNumber, year);
      return { start: m.index!, end: m.index! + m[0].length, raw: m[0], verified, lawNumber };
    })
  );
}

async function findDecisionSpans(text: string): Promise<Span[]> {
  const matches = [...text.matchAll(DECISION_RE)];
  return Promise.all(
    matches.map(async (m) => {
      const decisionNumber = m[1] ?? m[3];
      const year = Number(m[2] ?? m[4]);
      const verified = await verifyDecision(decisionNumber, year);
      return { start: m.index!, end: m.index! + m[0].length, raw: m[0], verified };
    })
  );
}

/** The nearest law span within WINDOW chars — before or after — or null if none is close enough. */
function nearestLaw(article: { start: number; end: number }, lawSpans: LawSpan[]): LawSpan | null {
  let best: LawSpan | null = null;
  let bestDist = Infinity;
  for (const law of lawSpans) {
    const dist =
      law.end <= article.start ? article.start - law.end : law.start >= article.end ? law.start - article.end : 0;
    if (dist <= WINDOW && dist < bestDist) {
      best = law;
      bestDist = dist;
    }
  }
  return best;
}

async function findArticleSpans(text: string, lawSpans: LawSpan[]): Promise<Span[]> {
  // Same reasoning as findLawSpans: lawSpans is already fully resolved by the
  // time this runs, so each article's lookup is independent of the others and
  // safe to fan out concurrently rather than one DB round-trip at a time.
  const matches = [...text.matchAll(ARTICLE_RE)];
  return Promise.all(
    matches.map(async (m) => {
      const articleNumber = m[1] ?? m[2];
      const start = m.index!;
      const end = start + m[0].length;
      const law = nearestLaw({ start, end }, lawSpans);
      // No law context, or the law itself didn't verify: an article number
      // alone is not a citation you can check, so it is not one you can trust.
      const verified = law !== null && law.verified && (await verifyArticleInLaw(articleNumber, law.lawNumber));
      return { start, end, raw: m[0], verified };
    })
  );
}

function sweepDanglingYears(s: string): { text: string; count: number } {
  let count = 0;
  const text = s.replace(YEAR_RE, () => {
    count++;
    return REDACTION;
  });
  return { text, count };
}

export type VerifiedCitations = {
  text: string;
  /** Citations confirmed against the database and left intact. */
  verifiedCount: number;
  /** Citation-shaped spans that did not verify, and were redacted. */
  redactedCount: number;
};

/**
 * Extracts every citation-shaped span in `text`, checks each against the
 * database, and returns the text with unverified spans replaced by the same
 * `REDACTION` marker `guard.ts` uses elsewhere — verified ones are left
 * exactly as GPT wrote them.
 */
export async function verifyAndCleanCitations(text: string): Promise<VerifiedCitations> {
  const normalized = normalizeDigits(text);

  // Laws first: article verification below needs their (verified) law numbers
  // as context, and decisions are independent of both.
  const lawSpans = await findLawSpans(normalized);
  const [articleSpans, decisionSpans] = await Promise.all([
    findArticleSpans(normalized, lawSpans),
    findDecisionSpans(normalized),
  ]);

  const spans = [...lawSpans, ...articleSpans, ...decisionSpans].sort((a, b) => a.start - b.start);

  let verifiedCount = 0;
  let redactedCount = 0;
  const pieces: string[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start < cursor) continue; // defensive: skip an unexpected overlap

    const gap = sweepDanglingYears(normalized.slice(cursor, span.start));
    pieces.push(gap.text);
    redactedCount += gap.count;

    if (span.verified) {
      pieces.push(span.raw);
      verifiedCount++;
    } else {
      pieces.push(REDACTION);
      redactedCount++;
    }
    cursor = span.end;
  }

  const tail = sweepDanglingYears(normalized.slice(cursor));
  pieces.push(tail.text);
  redactedCount += tail.count;

  return { text: pieces.join(""), verifiedCount, redactedCount };
}
