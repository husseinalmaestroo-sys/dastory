import "server-only";
import { foldForSearch, normalizeDigits } from "../ingest/clean";

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

  const articleNumbers = articleNumbersIn(question);

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

// ---------------------------------------------------------------- article references

/**
 * Article numbers a question cites, in order of appearance.
 *
 * Phase 2.1: the lookup forms lawyers actually write. Before this only
 * "المادة 17" and "المادة (17)" were read; each form below returned no
 * article at all (the ordinal and abbreviated forms) or fell through to
 * whole-corpus search:
 *   "المادة رقم 17"                        — رقم between the word and the number
 *   "م 17", "م.17", "م/17"                 — the abbreviation used in pleadings
 *   "المادتين 40 و41", "المواد 5 و6 و7"    — dual and plural
 *   "المادة السابعة عشرة", "المادة الحادية والعشرون",
 *   "المادة الخامسة بعد المائة"             — ordinal words, feminine or masculine
 */
export function articleNumbersIn(question: string): string[] {
  const out: string[] = [];
  for (const span of articleReferenceSpans(foldForSearch(question))) {
    for (const n of span.numbers) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The folded text with every article reference removed (what is left is the lookup's context). */
export function stripArticleReferences(folded: string): string {
  let out = "";
  let cursor = 0;
  for (const s of articleReferenceSpans(folded)) {
    out += `${folded.slice(cursor, s.start)} `;
    cursor = s.end;
  }
  return out + folded.slice(cursor);
}

type ArticleSpan = { start: number; end: number; numbers: string[] };

const OPEN = "[({\\[]?";
const NUM = "(\\d{1,4})(?!\\d)";
// "و41", "، 42", "و المادة 43" — the continuation of a dual/plural list. (A
// dash is a range, "10-15", and is deliberately not read as two articles.)
const LIST_TAIL = "((?:\\s*[)}\\]]?\\s*(?:و|،|,)\\s*(?:ال)?(?:ماده\\s*)?[({\\[]?\\s*\\d{1,4}(?!\\d))*)";
const ARTICLE_PATTERNS: { re: RegExp; abbreviation?: boolean }[] = [
  { re: new RegExp(`ماده\\s*(?:رقم\\s*)?${OPEN}\\s*${NUM}`, "g") },
  { re: new RegExp(`مادت(?:ين|ان|ي|ا)\\s*(?:رقم\\s*)?${OPEN}\\s*${NUM}${LIST_TAIL}`, "g") },
  { re: new RegExp(`مواد\\s*(?:رقم\\s*)?${OPEN}\\s*${NUM}${LIST_TAIL}`, "g") },
  // "م 17" / "م.17" / "م/17": a lone م (no letter or digit before it), not
  // followed by "/" (a date or a decision number). A four-digit 19xx/20xx
  // after it is a year, not an article.
  { re: new RegExp(`(?<![\\p{L}\\p{N}])م\\s*[./]?\\s*${NUM}(?![/])`, "gu"), abbreviation: true },
];

// Ordinal words, folded (ة→ه, ى→ي, أ→ا, ئ→ي). An article is feminine (المادة
// السابعة عشرة) but the masculine forms are common in practice.
const ORD_UNIT: Record<string, number> = {
  الاولي: 1, الاول: 1, الحاديه: 1, الحادي: 1, الثانيه: 2, الثاني: 2, الثالثه: 3, الثالث: 3, الرابعه: 4, الرابع: 4,
  الخامسه: 5, الخامس: 5, السادسه: 6, السادس: 6, السابعه: 7, السابع: 7, الثامنه: 8, الثامن: 8, التاسعه: 9, التاسع: 9,
};
const ORD_TENS: Record<string, number> = {
  العاشره: 10, العاشر: 10, العشرون: 20, العشرين: 20, الثلاثون: 30, الثلاثين: 30, الاربعون: 40, الاربعين: 40,
  الخمسون: 50, الخمسين: 50, الستون: 60, الستين: 60, السبعون: 70, السبعين: 70, الثمانون: 80, الثمانين: 80,
  التسعون: 90, التسعين: 90,
};
const ORD_HUNDREDS: Record<string, number> = Object.fromEntries(
  (
    [
      [["المايه", "الميه"], 100],
      [["المايتين", "المايتان", "الميتين", "الميتان"], 200],
      [["الثلاثمايه", "الثلاثميه"], 300],
      [["الاربعمايه", "الاربعميه"], 400],
      [["الخمسمايه", "الخمسميه"], 500],
      [["الستمايه", "الستميه"], 600],
      [["السبعمايه", "السبعميه"], 700],
      [["الثمانمايه", "الثمانميه", "الثمانيمايه"], 800],
      [["التسعمايه", "التسعميه"], 900],
    ] as [string[], number][]
  ).flatMap(([forms, n]) => forms.map((f) => [f, n]))
);
const TEEN = new Set(["عشر", "عشره"]);

/** "السابعه عشره" → 17, "الحاديه والعشرون" → 21, "الخامسه بعد المايه" → 105; null when the words are not an ordinal. */
export function parseOrdinal(words: string[]): { value: number; length: number } | null {
  const [w0, w1] = words;
  let value: number;
  let i: number;
  if (w0 in ORD_UNIT) {
    const unit = ORD_UNIT[w0];
    if (w1 && TEEN.has(w1)) {
      value = 10 + unit;
      i = 2;
    } else if (w1 && w1.startsWith("و") && ORD_TENS[w1.slice(1)] >= 20) {
      value = ORD_TENS[w1.slice(1)] + unit;
      i = 2;
    } else if (w0 === "الحاديه" || w0 === "الحادي") {
      return null; // only ever part of 11, 21, 31…
    } else {
      value = unit;
      i = 1;
    }
  } else if (w0 in ORD_TENS) {
    value = ORD_TENS[w0];
    i = 1;
  } else if (w0 in ORD_HUNDREDS) {
    return { value: ORD_HUNDREDS[w0], length: 1 };
  } else {
    return null;
  }
  if (words[i] === "بعد" && words[i + 1] in ORD_HUNDREDS) {
    value += ORD_HUNDREDS[words[i + 1]];
    i += 2;
  }
  return { value, length: i };
}

function articleReferenceSpans(folded: string): ArticleSpan[] {
  const spans: ArticleSpan[] = [];
  const overlaps = (start: number, end: number) => spans.some((s) => start < s.end && end > s.start);
  // "الماده", "للماده", "بالمادتين": the reference starts at its word's first letter.
  const wordStart = (i: number) => {
    while (i > 0 && /\p{L}/u.test(folded[i - 1])) i--;
    return i;
  };
  for (const { re, abbreviation } of ARTICLE_PATTERNS) {
    for (const m of folded.matchAll(re)) {
      const start = abbreviation ? m.index! : wordStart(m.index!);
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const first = m[1];
      if (abbreviation && first.length === 4 && /^(?:19|20)/.test(first)) continue; // "م 2020" is a year
      const rest = m[2] ? [...m[2].matchAll(/\d{1,4}/g)].map((x) => x[0]) : [];
      spans.push({ start, end, numbers: [first, ...rest].map((n) => String(Number(n))).filter((n) => n !== "0") });
    }
  }
  // Ordinals: "ماده" followed by ordinal words.
  for (const m of folded.matchAll(/ماده((?:\s+[^\s\d]+){1,4})/g)) {
    const start = wordStart(m.index!);
    if (overlaps(m.index!, m.index! + 4)) continue;
    const words = m[1].trim().split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, ""));
    const ord = parseOrdinal(words);
    if (!ord) continue;
    // End of the span: after the ordinal's last word.
    let end = m.index! + 4;
    let seen = 0;
    const re = /\s+([^\s]+)/g;
    re.lastIndex = end;
    let w: RegExpExecArray | null;
    while (seen < ord.length && (w = re.exec(folded))) {
      end = w.index + w[0].length;
      seen++;
    }
    spans.push({ start, end, numbers: [String(ord.value)] });
  }
  return spans.sort((a, b) => a.start - b.start);
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
