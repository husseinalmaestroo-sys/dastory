import "server-only";
import { normalizeDigits } from "../ingest/clean";

export type QueryIntent = {
  /** "المادة 202" → "202" */
  articleNumbers: string[];
  /** "قرار 1234/2020" → "1234/2020" */
  decisionNumbers: string[];
  court: string | null;
  year: number | null;
  category: string | null;
  /** True when the lawyer is looking up a specific citation, not a concept. */
  isLookup: boolean;
  /**
   * The lawyer is asking what the law was AS OF a past year — "ماذا كان القانون
   * في عام 2015". Distinct from a law's own year ("رقم 8 لسنة 1996"), which is
   * NOT an as-of date. Drives version retrieval: null means "today".
   */
  asOfYear: number | null;
  /**
   * The lawyer explicitly wants a previous / superseded / repealed version
   * ("النسخة السابقة", "قبل التعديل", "القانون الملغى"), or named a past date.
   * When false, retrieval returns only the current in-force version.
   */
  wantsHistorical: boolean;
};

const COURTS: [RegExp, string][] = [
  [/تمييز/, "محكمة التمييز"],
  [/استئناف/, "محكمة الاستئناف"],
  [/بداية/, "محكمة البداية"],
  [/صلح/, "محكمة الصلح"],
  [/أمن\s*الدولة|امن\s*الدوله/, "محكمة أمن الدولة"],
  [/دستوري/, "المحكمة الدستورية"],
  [/جنايات/, "محكمة الجنايات الكبرى"],
];

const CATEGORIES: [RegExp, string][] = [
  [/حقوقي/, "حقوقية"],
  [/جزائي|جنائي/, "جزائية"],
  [/عمالي|عمل\b/, "عمالية"],
  [/تجاري/, "تجارية"],
  [/شركات/, "شركات"],
  [/مدني/, "مدنية"],
  [/أمن\s*الدولة|امن\s*الدوله/, "أمن دولة"],
];

/**
 * Pulls structured citation targets out of a natural-language question.
 *
 * This is what makes hybrid search worth the complexity: "ما هي المادة 202"
 * is a lookup where an exact number match must dominate, while "شروط فسخ عقد
 * المقاولة" is a concept search where the vector should. Same endpoint, and
 * the weighting flips based on what we find here.
 */
export function parseIntent(question: string): QueryIntent {
  const q = normalizeDigits(question);

  const articleNumbers = [...q.matchAll(/(?:ال)?ماد[ةه]\s*[({\[]?\s*(\d{1,4})/g)].map((m) => m[1]);

  const decisionNumbers = [
    ...q.matchAll(/(?:قرار|حكم|طعن|دعوى|تمييز)\s*(?:رقم\s*)?\(?\s*(\d{1,6})\s*[/\-]\s*(\d{4})/g),
  ].map((m) => `${m[1]}/${m[2]}`);

  // A bare "1234/2020" is a citation too.
  if (decisionNumbers.length === 0) {
    for (const m of q.matchAll(/\b(\d{1,6})\s*\/\s*(19\d{2}|20\d{2})\b/g)) {
      decisionNumbers.push(`${m[1]}/${m[2]}`);
    }
  }

  const court = COURTS.find(([re]) => re.test(q))?.[1] ?? null;
  const category = CATEGORIES.find(([re]) => re.test(q))?.[1] ?? null;

  // Only trust a year the lawyer framed as one ("لسنة 2020"). A bare 4-digit
  // number in prose is more often a law number than a year, and filtering on
  // a wrong year silently returns nothing.
  const yearMatch = q.match(/(?:لسنة|سنة|عام)\s*(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  const { asOfYear, wantsHistorical } = parseTemporalScope(q);

  return {
    articleNumbers,
    decisionNumbers,
    court,
    year,
    category,
    isLookup: articleNumbers.length > 0 || decisionNumbers.length > 0,
    asOfYear,
    wantsHistorical,
  };
}

// Words that ask for a past / superseded / repealed version rather than the one
// in force today. Kept separate from the as-of-year match so "قبل التعديل" (no
// year) still flips the query into historical mode.
const HISTORICAL_HINTS =
  /النسخة\s*(?:السابقة|القديمة|الملغاة)|النص\s*(?:السابق|القديم|الملغى)|قبل\s*(?:ال)?تعديل|القانون\s*(?:السابق|القديم|الملغى|المُلغى)|الملغا[ةه]|المُلغا[ةه]|كان\s*(?:ينص|معمولا|ساريا|نافذا)|الصيغة\s*(?:السابقة|القديمة)/;

/**
 * Decides whether the question is temporal — asking about the law at a past
 * point — and extracts the as-of year when one is framed as such.
 *
 * The hard case is telling an as-of date from a law's OWN year. "قانون العمل
 * رقم 8 لسنة 1996" is not a request for the 1996 state of the law, so a bare
 * "لسنة YYYY" must NOT count. An as-of year is only read from an explicit
 * temporal preposition — "في عام 2015", "حتى سنة 2018", "قبل 2019", "كما كان
 * في 2015" — and never from "لسنة"/"رقم" phrasing.
 */
function parseTemporalScope(q: string): { asOfYear: number | null; wantsHistorical: boolean } {
  const now = new Date().getFullYear();

  const m = q.match(/(?:في|حتى|لغاية|بحلول|قبل|كما\s*كان\s*(?:في|عام|سنة)?)\s*(?:عام|سنة|تاريخ)?\s*(19\d{2}|20\d{2})/);
  let asOfYear: number | null = null;
  if (m) {
    // Guard against catching a law's own year: reject when the matched slice
    // is really "لسنة YYYY" or "رقم … YYYY". The alternation above already
    // excludes "لسنة", but a defensive check keeps a future edit from
    // reintroducing the trap.
    const y = Number(m[1]);
    if (y >= 1900 && y <= now) asOfYear = y;
  }

  const wantsHistorical = asOfYear !== null || HISTORICAL_HINTS.test(q);
  return { asOfYear, wantsHistorical };
}

/**
 * The version-retrieval decision, taken in code, never by the model.
 *
 *   • Default (no temporal signal): return ONLY the current in-force version.
 *   • Historical question: lift that filter, and — when an as-of year is
 *     given — restrict to versions already in effect by the end of that year.
 *
 * Returned as a plain scope object so hybrid.ts can pass it straight into SQL
 * and so it is unit-testable without a database.
 */
export type VersionScope = { currentOnly: boolean; asOfDate: string | null };

export function resolveVersionScope(intent: QueryIntent): VersionScope {
  if (intent.wantsHistorical) {
    return { currentOnly: false, asOfDate: intent.asOfYear ? `${intent.asOfYear}-12-31` : null };
  }
  return { currentOnly: true, asOfDate: null };
}
