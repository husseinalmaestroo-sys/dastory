import "server-only";

/**
 * Comparison-question detection — "ما الفرق بين X و Y؟" and its variants.
 *
 * WHY THIS IS ITS OWN MODULE, NOT A FIELD ON query-understanding.ts's
 * analyzeQueryRules
 *
 * query-understanding.ts already classifies "ما الفرق بين X و Y؟" as
 * queryType "doctrinal_question" (see DOCTRINAL_Q) — that classification
 * decides the relevance floor and confidence weighting, and is unaffected by
 * anything here. What THAT layer does not do is pull X and Y apart: a
 * comparison question is really two concept questions the lawyer wants
 * answered side by side, and a single fused vector/keyword query — the same
 * treatment every other doctrinal_question gets — routinely starves one side
 * for the other's benefit (confirmed live, 2026-07-25: "ما الفرق بين البطلان
 * المطلق والبطلان النسبي؟" retrieved the absolute-nullity side fine and never
 * surfaced the relative-nullity side at all, even after ontology expansion
 * merges both sides' vocabulary into one query — see hybrid.ts's
 * comparisonSearch for why a single merged query still isn't enough on its
 * own). This module is the extraction step that makes a DEDICATED retrieval
 * pass per side possible.
 *
 * Deliberately conservative: only fires behind an explicit comparison signal
 * (الفرق/قارن/مقارنة/الاختلاف), and returns null rather than a bad guess when
 * the two sides can't be pulled apart with confidence. A null result costs
 * nothing — the caller just falls back to the single-query path every other
 * doctrinal_question already uses, so a missed detection is never a
 * regression, only a missed improvement.
 */

export type ComparisonSplit = {
  /** The first concept, as the lawyer phrased it — e.g. "البطلان المطلق". */
  sideA: string;
  /** The second concept — e.g. "البطلان النسبي". */
  sideB: string;
};

const COMPARISON_SIGNAL = /الفرق|الاختلاف|قارن|مقارن[ةه]|أيهما/;

const MIN_SIDE_LEN = 2;
const MAX_SIDE_LEN = 60;

/**
 * "بين X و Y" — X is everything after "بين" up to the first "space + و"
 * boundary; Y is everything after that "و" up to a clause boundary (a
 * trailing qualifier clause like "في القانون المدني", "من حيث الأثر", a
 * comma, or the question mark). Both captures are lazy so they take the
 * SHORTEST span satisfying the pattern, which is what keeps this from
 * swallowing a whole sentence when "بين"/"و" appear again later (a
 * multi-clause question like the reported example: "...البطلان النسبي في
 * القانون المدني الأردني؟ وما أثر كل منهما على العقد؟" has a SECOND "و" deep
 * in the trailing clause that a greedy match would wrongly reach for).
 */
// No `\b` anywhere here on purpose: JS word boundaries are defined against
// [A-Za-z0-9_] and Arabic letters are never "word" characters to that engine,
// so `\b` right after an Arabic word is dead — it silently never matches (see
// query-understanding.ts's own DRAFT_VERB comment for the same trap) and the
// lazy capture below would skip past the intended stop word entirely. A
// lookahead for whitespace/punctuation/end does the same job correctly.
const STOP_WORD = /(?:في|من\s+حيث|على|فيما\s+يتعلق|وذلك|وما)(?=\s|[،,؟?]|$)/;
const BETWEEN_SPLIT = new RegExp(`بين\\s+(.+?)\\s+و\\s*(.+?)(?:\\s+${STOP_WORD.source}|[،,؟?]|$)`);

function clean(side: string): string {
  return side.trim().replace(/^[\s،,]+|[\s،,؟?]+$/g, "").trim();
}

/**
 * Extracts both sides of a comparison question, or null if none is
 * confidently detected. Never throws — worst case is a missed detection.
 */
export function detectComparison(question: string): ComparisonSplit | null {
  if (!COMPARISON_SIGNAL.test(question)) return null;

  const m = BETWEEN_SPLIT.exec(question);
  if (!m) return null;

  const sideA = clean(m[1]);
  const sideB = clean(m[2]);

  if (sideA.length < MIN_SIDE_LEN || sideB.length < MIN_SIDE_LEN) return null;
  if (sideA.length > MAX_SIDE_LEN || sideB.length > MAX_SIDE_LEN) return null;
  // "بين الطرفين" / "بينهما" and similar — a pronoun, not a named concept.
  if (/^(?:ال)?طرف|هما$|هم$/.test(sideA) || /^(?:ال)?طرف|هما$|هم$/.test(sideB)) return null;

  return { sideA, sideB };
}
