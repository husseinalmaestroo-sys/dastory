import "server-only";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { stemArabicWord } from "../search/arabic-stem";
import { expandLawAbbreviations, extractAllLawReferences } from "../search/law-reference";
import type { RetrievedChunk } from "../search/types";

/**
 * DETERMINISTIC LEGAL-MEANING CHECKS (Phase 2.1).
 *
 * Phase 2's grounding judged support by lexical overlap only. The held-out
 * adversarial set (eval/dataset.json, committed before this module) showed
 * what that misses: a claim that reuses its source's words while reversing
 * or narrowing the rule passed as "supported" — "يجوز" for "لا يجوز … إلا",
 * "بالإعدام" for "بالحبس", "خطأً" for "عمداً", a rule stated without the
 * "ما لم …" that limits it, and a source that shares words with the answer
 * but not with the QUESTION (a law's short-title article). These are the
 * checks that catch those, in code, before any model judge:
 *
 *   numbers        every figure in a claim — digits AND number words
 *                  ("ستون", "واحد وعشرون") — must be a figure of its source;
 *   critical terms the penalty type (death, hard labour, detention,
 *                  imprisonment, fine, confiscation), the mental element
 *                  (intent / negligence) and the remedy (compensation,
 *                  nullity, rescission, eviction) a claim states must be in
 *                  its source;
 *   polarity       a permission/obligation/penalty verb the claim states must
 *                  have the same polarity in the source sentence it comes
 *                  from ("يجوز" vs "لا يجوز"), allowing the one legitimate
 *                  inversion "لا يجوز … إلا بـX" → "يجوز بـX";
 *   conditions     a claim built on a source sentence whose rule carries a
 *                  condition or exception ("إذا …", "ما لم …", "إلا …",
 *                  "بشرط …") must reflect it, or it is labelled;
 *   relevance      a cited source must share subject matter with the question
 *                  (the law's name does not count when the question names the
 *                  law), and a short-title/commencement article never answers
 *                  a substantive question;
 *   premises       what a question asserts about an article ("بما أن المادة 20
 *                  تمنح … ستين يوماً") is checked against that article with the
 *                  same number / critical-term / polarity rules.
 *
 * All of it is heuristic and conservative: when a check cannot tell (no
 * matching sentence, no shared verb), it says nothing, and the semantic judge
 * (self-verify.ts) remains the second line. What these rules remove or label
 * is listed per claim in the grounding report, never silently.
 */

// ------------------------------------------------------------------ text basics

export function normText(text: string): string {
  return foldForSearch(normalizeDigits(text))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const f = (w: string) => foldForSearch(w);

export const STOP = new Set(
  [
    "في", "من", "على", "الى", "إلى", "عن", "ان", "أن", "إن", "او", "أو", "ما", "هل", "هو", "هي", "التي", "الذي", "الذين",
    "هذا", "هذه", "ذلك", "تلك", "كل", "اي", "أي", "مع", "بين", "قد", "لا", "لم", "لن", "ثم", "و", "كان", "كانت", "يكون",
    "تكون", "به", "بها", "له", "لها", "فيه", "فيها", "عليه", "عليها", "منه", "منها", "وفقا", "وفق", "حسب", "لذلك", "كما",
    "اذا", "إذا", "حيث", "انه", "انها", "بان", "يمكن", "عند", "بعد", "قبل", "غير", "ايضا", "اما", "الا", "إلا", "سوف",
    "تم", "يتم", "فهل", "وهل", "فما", "وما",
    "مصدر", "المصدر", "الخلاصة", "الشرح", "النص", "القانوني", "المحامي", "the", "a", "an", "of", "to", "in", "and", "or",
    "is", "are",
  ].map(f)
);

/** Light-stemmed content words (stop words and bare numbers removed). */
export function stems(text: string): string[] {
  return normText(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => stemArabicWord(w) || w);
}

type Tok = { raw: string; folded: string; start: number; end: number };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}ً-ٰٟـ]+/gu)) {
    // foldForSearch drops a lone number (cleanText treats it as a page number): digits stay digits.
    const folded = /^\p{N}+$/u.test(m[0]) ? normalizeDigits(m[0]) : foldForSearch(m[0]);
    out.push({ raw: m[0], folded, start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** The word without one attached conjunction (و/ف), one preposition (ب/ل/ك) and the article. */
function bareForms(folded: string): string[] {
  const forms = new Set<string>([folded]);
  let w = folded;
  if (/^[وف]/.test(w) && w.length > 3) {
    w = w.slice(1);
    forms.add(w);
  }
  if (/^[بلك]/.test(w) && w.length > 3) {
    w = w.slice(1);
    forms.add(w);
  }
  if (w.startsWith("ال") && w.length > 4) forms.add(w.slice(2));
  return [...forms];
}

// ------------------------------------------------------------------ numbers

type NumKind = "unit" | "ten" | "tens" | "hundreds" | "hundredMul" | "thousands" | "thousandMul" | "dual";
const NUMBER_WORDS = new Map<string, { kind: NumKind; value: number }>();
const addWords = (kind: NumKind, value: number, words: string[]) => {
  for (const w of words) NUMBER_WORDS.set(f(w), { kind, value });
};
addWords("unit", 1, ["واحد", "واحدة", "أحد", "إحدى"]);
addWords("unit", 2, ["اثنان", "اثنين", "اثنتان", "اثنتين", "اثنا", "اثني", "اثنتا", "اثنتي"]);
addWords("unit", 3, ["ثلاث", "ثلاثة"]);
addWords("unit", 4, ["أربع", "أربعة"]);
addWords("unit", 5, ["خمس", "خمسة"]);
addWords("unit", 6, ["ست", "ستة"]);
addWords("unit", 7, ["سبع", "سبعة"]);
addWords("unit", 8, ["ثمان", "ثماني", "ثمانية"]);
addWords("unit", 9, ["تسع", "تسعة"]);
addWords("ten", 10, ["عشر", "عشرة"]);
addWords("tens", 20, ["عشرون", "عشرين"]);
addWords("tens", 30, ["ثلاثون", "ثلاثين"]);
addWords("tens", 40, ["أربعون", "أربعين"]);
addWords("tens", 50, ["خمسون", "خمسين"]);
addWords("tens", 60, ["ستون", "ستين"]);
addWords("tens", 70, ["سبعون", "سبعين"]);
addWords("tens", 80, ["ثمانون", "ثمانين"]);
addWords("tens", 90, ["تسعون", "تسعين"]);
addWords("hundredMul", 100, ["مئة", "مائة"]);
addWords("hundreds", 200, ["مئتان", "مائتان", "مئتي", "مائتي", "مئتين", "مائتين"]);
for (const [n, v] of [["ثلاث", 300], ["أربع", 400], ["خمس", 500], ["ست", 600], ["سبع", 700], ["ثمان", 800], ["تسع", 900]] as const) {
  addWords("hundreds", v, [`${n}مئة`, `${n}مائة`]);
}
addWords("thousandMul", 1000, ["ألف", "آلاف", "الاف"]);
addWords("thousands", 2000, ["ألفا", "ألفان", "ألفين"]);
addWords("dual", 2, ["سنتين", "سنتان", "شهرين", "شهران", "يومين", "يومان", "أسبوعين", "أسبوعان", "ساعتين", "ساعتان"]);

function numberWord(folded: string): { kind: NumKind; value: number } | null {
  for (const form of bareForms(folded)) {
    const hit = NUMBER_WORDS.get(form);
    if (hit) return hit;
  }
  return null;
}

const startsWithWaw = (folded: string) => folded.startsWith("و") && !NUMBER_WORDS.has(folded);

// A lone unit or "عشرة" is a figure only before a countable noun: "لأحد
// الطرفين" or "كل واحد منهما" is not the number one.
const COUNTABLE = new Set(
  [
    "يوم", "يوما", "يوماً", "أيام", "شهر", "شهرا", "أشهر", "شهور", "سنة", "سنوات", "سنين", "عام", "أعوام", "ساعة", "ساعات",
    "أسبوع", "أسابيع", "دينار", "دنانير", "مرة", "مرات", "مثل", "أمثال", "أضعاف", "درجة", "درجات", "قسط", "أقساط", "بالمئة",
    "بالمائة", "بالألف", "أشخاص", "شهود", "فرص", "جلسات",
  ].map(f)
);
const isCountable = (folded: string | undefined) => !!folded && bareForms(folded).some((w) => COUNTABLE.has(w));

export type NumberMention = { value: number; start: number; end: number; source: "digits" | "words" };

/**
 * Every figure in `text`: digit runs (Arabic-Indic digits normalised) and
 * cardinal number words, compounds included ("واحد وعشرون" = 21, "خمسة عشر"
 * = 15, "مائة وخمسون" = 150, "خمسة آلاف" = 5000, "سنتين" = 2). Offsets refer
 * to normalizeDigits(text), which has the same length as `text`.
 */
export function numberMentions(text: string): NumberMention[] {
  const t = normalizeDigits(text);
  const out: NumberMention[] = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) {
    out.push({ value: Number(m[0].replace(",", ".")), start: m.index!, end: m.index! + m[0].length, source: "digits" });
  }
  const toks = tokenize(t);
  for (let i = 0; i < toks.length; i++) {
    const a = numberWord(toks[i].folded);
    if (!a || a.kind === "thousandMul") continue;
    let value = a.value;
    let j = i;
    const next = (k: number) => (k < toks.length ? numberWord(toks[k].folded) : null);
    if (a.kind === "unit") {
      const b = next(j + 1);
      if (b?.kind === "ten" && !startsWithWaw(toks[j + 1].folded)) {
        value += 10; // خمسة عشر
        j++;
      } else if (b?.kind === "tens" && startsWithWaw(toks[j + 1].folded)) {
        value += b.value; // واحد وعشرون
        j++;
      } else if (b?.kind === "hundredMul") {
        value *= 100; // ثلاث مئة
        j++;
      }
    }
    if (a.kind === "hundreds" || a.kind === "hundredMul" || (a.kind === "unit" && value >= 100)) {
      // مائة وخمسون / مئتان وخمسة وعشرون
      const b = next(j + 1);
      if (b && startsWithWaw(toks[j + 1].folded) && (b.kind === "unit" || b.kind === "tens" || b.kind === "ten")) {
        value += b.value;
        j++;
        const c = next(j + 1);
        if (b.kind === "unit" && c?.kind === "tens" && startsWithWaw(toks[j + 1].folded)) {
          value += c.value;
          j++;
        }
      }
    }
    const mul = next(j + 1);
    if (mul?.kind === "thousandMul" && value < 1000) {
      value *= 1000; // خمسة آلاف
      j++;
    }
    const compound = j > i;
    if ((a.kind === "unit" || a.kind === "ten") && !compound && !isCountable(toks[j + 1]?.folded)) continue;
    out.push({ value, start: toks[i].start, end: toks[j].end, source: "words" });
    i = j;
  }
  return out;
}

export function numberValues(text: string): Set<number> {
  return new Set(numberMentions(text).map((m) => m.value));
}

// ------------------------------------------------------------------ critical terms

// Folded patterns; each must start a word (optionally after و/ف, ب/ل, ال) and end one.
const PRE = "(?:^|\\s)(?:[وف])?(?:[بل])?(?:ال)?";
const CRITICAL: { category: string; re: RegExp }[] = [
  { category: "penalty:death", re: new RegExp(`${PRE}اعدام(?=\\s|$)`) },
  { category: "penalty:hard_labour", re: new RegExp(`${PRE}اشغال(?=\\s|$)`) },
  { category: "penalty:detention", re: new RegExp(`${PRE}اعتقال(?=\\s|$)`) },
  { category: "penalty:imprisonment", re: new RegExp(`${PRE}(?:حبس|سجن)(?:ا)?(?=\\s|$)`) },
  { category: "penalty:fine", re: new RegExp(`${PRE}غرام(?:ه|ات)(?=\\s|$)`) },
  { category: "penalty:confiscation", re: new RegExp(`${PRE}مصادره(?=\\s|$)`) },
  { category: "mens:intent", re: new RegExp(`${PRE}(?:عمد|عمدا|عمدي|عمديه|متعمد|متعمدا|قصد|قصدا|قصدي)(?=\\s|$)`) },
  { category: "mens:negligence", re: new RegExp(`${PRE}(?:خطا|خطاي|اهمال|تقصير)(?=\\s|$)`) },
  // Remedies and consequences: a claim may not grant one its source does not.
  { category: "remedy:compensation", re: new RegExp(`${PRE}(?:تعويض|تعويضا|تعويضات|يعوض|تعوض)(?=\\s|$)`) },
  { category: "remedy:nullity", re: new RegExp(`${PRE}(?:باطل|باطلا|باطله|بطلان|يبطل|تبطل)(?=\\s|$)`) },
  { category: "remedy:rescission", re: new RegExp(`${PRE}(?:فسخ|يفسخ|تفسخ|انفساخ)(?=\\s|$)`) },
  { category: "remedy:eviction", re: new RegExp(`${PRE}(?:اخلاء|يخلي|تخليه)(?=\\s|$)`) },
];

/** Penalty types and mental elements named in `text`. */
export function criticalCategories(text: string): Set<string> {
  const t = ` ${normText(text)} `;
  return new Set(CRITICAL.filter((c) => c.re.test(t)).map((c) => c.category));
}

// ------------------------------------------------------------------ polarity

type Modal = { family: string; polarity: 1 | -1 };
const MODALS = new Map<string, Modal>();
const addModal = (family: string, polarity: 1 | -1, words: string[]) => {
  for (const w of words) MODALS.set(f(w), { family, polarity });
};
addModal("permit", 1, ["يجوز", "تجوز", "جائز", "جائزة", "يجيز", "تجيز", "أجاز", "أجازت", "يحق", "تحق", "يباح", "مباح", "جاز"]);
addModal("permit", -1, ["يحظر", "تحظر", "محظور", "محظورة", "يمنع", "تمنع", "ممنوع", "ممنوعة"]);
addModal("oblige", 1, ["يلتزم", "تلتزم", "يلزم", "تلزم", "ملزم", "ملزمة", "يجب", "تجب", "واجب", "واجبة", "وجب"]);
addModal("punish", 1, ["يعاقب", "تعاقب", "يعاقبون", "عوقب"]);
addModal("apply", 1, ["يسري", "تسري"]);
addModal("entitle", 1, ["يستحق", "تستحق"]);
addModal("require", 1, ["يشترط", "تشترط"]);
addModal("deem", 1, ["يعتبر", "تعتبر"]);
addModal("lapse", 1, ["يسقط", "تسقط", "سقط"]);
addModal("accept", 1, ["يقبل", "تقبل"]);
const NEGATORS = new Set(["لا", "لم", "لن", "ليس", "ليست", "غير", "عدم"].map(f));

export type PolarMention = { family: string; polarity: 1 | -1; index: number };

function modalOf(folded: string): Modal | null {
  for (const form of bareForms(folded)) {
    const m = MODALS.get(form);
    if (m) return m;
  }
  return null;
}

function isNegator(folded: string): boolean {
  return NEGATORS.has(folded) || (/^[وف]/.test(folded) && NEGATORS.has(folded.slice(1)));
}

/** Permission/obligation/penalty verbs in `text`, with their polarity after negation. */
export function polarities(text: string): PolarMention[] {
  const toks = tokenize(normalizeDigits(text));
  const out: PolarMention[] = [];
  toks.forEach((t, i) => {
    const m = modalOf(t.folded);
    if (!m) return;
    const negated = i > 0 && isNegator(toks[i - 1].folded);
    out.push({ family: m.family, polarity: (negated ? -m.polarity : m.polarity) as 1 | -1, index: i });
  });
  return out;
}

// ------------------------------------------------------------------ conditions

export type ConditionClause = { marker: string; text: string };

const POST_MARKER_RE = /(?:^|[\s،,])(?:و)?(إلا|الا|ما\s+لم|باستثناء|يستثنى|ما\s+عدا|عدا|بشرط|شريطة|على\s+(?:أن|ان)|مع\s+مراعاة)(?=\s)/g;
const PRE_MARKER_RE = /(?:^|[\s،,])(?:و|ف)?(إذا|اذا|متى|في\s+حال(?:ة)?)(?=\s)/g;
// Where the main clause of "إذا …" resumes.
const APODOSIS_RE = /\s(?:ف\S+|جاز|يجوز|وجب|يجب|يحق|حق|كان|اعتبر|يعتبر|تضاعفت|تضاعف|يعاقب|عوقب|سقط|يسقط|التزم|يلتزم|يكون|تكون|يستحق|استحق|يلزم|لزم)(?=\s|$)|[،,؛]/;

/** The conditions and exceptions a sentence attaches to its rule. */
export function conditionClauses(sentence: string): ConditionClause[] {
  const s = normalizeDigits(sentence);
  const out: ConditionClause[] = [];
  for (const m of s.matchAll(POST_MARKER_RE)) {
    const from = m.index! + m[0].length;
    const rest = s.slice(from);
    const stop = rest.search(/[،,؛.]/);
    out.push({ marker: m[1].replace(/\s+/g, " "), text: (stop >= 0 ? rest.slice(0, stop) : rest).trim() });
  }
  for (const m of s.matchAll(PRE_MARKER_RE)) {
    const from = m.index! + m[0].length;
    const rest = s.slice(from);
    const stop = rest.search(APODOSIS_RE);
    out.push({ marker: m[1].replace(/\s+/g, " "), text: (stop >= 0 ? rest.slice(0, stop) : rest).trim() });
  }
  return out.filter((c) => c.text.length > 0);
}

const MARKER_STEMS = new Set(stems("إلا ما لم باستثناء يستثنى عدا بشرط شريطة على أن مع مراعاة إذا متى في حال حالة"));

/**
 * The condition of `sentence` a claim drops: the first condition whose own
 * content (words that occur only in the condition, not in the rest of the
 * sentence) the claim shares nothing with — provided the claim does not carry
 * a condition marker of its own. Null when nothing is dropped.
 */
export function droppedCondition(claim: string, sentence: string): ConditionClause | null {
  const claimStems = new Set(stems(claim));
  if (conditionClauses(claim).length > 0) return null;
  for (const c of conditionClauses(sentence)) {
    const outside = new Set(stems(normalizeDigits(sentence).replace(c.text, " ")));
    const own = stems(c.text).filter((w) => !outside.has(w) && !MARKER_STEMS.has(w));
    if (own.length === 0) continue;
    if (!own.some((w) => claimStems.has(w))) return c;
  }
  return null;
}

// ------------------------------------------------------------------ source sentences

export function sourceSentences(text: string): string[] {
  return normalizeDigits(text)
    .split(/(?<=[.؛:!؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The sentences of `sourceText` a claim most plausibly comes from (best overlap, ties kept), with their overlap. */
export function matchingSentences(claim: string, sourceText: string): { sentence: string; overlap: number }[] {
  const want = new Set(stems(claim));
  const scored = sourceSentences(sourceText).map((sentence) => {
    let overlap = 0;
    for (const w of new Set(stems(sentence))) if (want.has(w)) overlap++;
    return { sentence, overlap };
  });
  const best = Math.max(0, ...scored.map((s) => s.overlap));
  if (best === 0) return [];
  return scored.filter((s) => s.overlap >= Math.max(1, best - 1));
}

// ------------------------------------------------------------------ meaning conflicts

export type MeaningIssue =
  | { kind: "critical_term"; category: string }
  | { kind: "polarity"; family: string }
  | { kind: "number"; value: number };

/**
 * Contradictions between `claim` and the source text it cites: a penalty type
 * or mental element the source does not state, and a permission/obligation/
 * penalty verb whose polarity is reversed in every matching source sentence.
 * (Figures are checked by the caller, which redacts rather than removes.)
 */
export function meaningConflicts(claim: string, sourceText: string): MeaningIssue[] {
  const issues: MeaningIssue[] = [];
  const srcCritical = criticalCategories(sourceText);
  for (const cat of criticalCategories(claim)) if (!srcCritical.has(cat)) issues.push({ kind: "critical_term", category: cat });

  const claimPol = polarities(claim);
  if (claimPol.length > 0) {
    const matches = matchingSentences(claim, sourceText);
    for (const family of new Set(claimPol.map((p) => p.family))) {
      const mine = new Set(claimPol.filter((p) => p.family === family).map((p) => p.polarity));
      if (mine.size !== 1) continue; // the claim itself states both — no single reading to check
      const polarity = [...mine][0];
      const theirs = matches.flatMap((m) => polarities(m.sentence).filter((p) => p.family === family).map((p) => ({ ...p, sentence: m.sentence })));
      if (theirs.length === 0) continue; // the source sentence does not use this verb: nothing to compare
      if (theirs.some((p) => p.polarity === polarity)) continue;
      // "لا يجوز … إلا بـX" legitimately restated as "يجوز … بـX".
      const exceptionRestated =
        polarity === 1 &&
        theirs.some((p) => {
          const exception = conditionClauses(p.sentence).find((c) => c.marker === "إلا" || c.marker === "الا");
          if (!exception) return false;
          const claimStems = new Set(stems(claim));
          return stems(exception.text).some((w) => claimStems.has(w) && !MARKER_STEMS.has(w));
        });
      if (!exceptionRestated) issues.push({ kind: "polarity", family });
    }
  }
  return issues;
}

// ------------------------------------------------------------------ relevance

// Words that carry no subject matter in a legal question.
const GENERIC = new Set(
  [
    "قانون", "القانون", "نظام", "تعليمات", "دستور", "مادة", "المادة", "مواد", "نص", "نصوص", "حكم", "أحكام", "الأردني", "أردني",
    "الأردن", "ماذا", "متى", "كيف", "كم", "لماذا", "أين", "ما", "هل", "يحدث", "يقول", "تقول", "ينص", "تنص", "بشأن", "بخصوص",
    "حول", "وفق", "بموجب", "رقم", "لسنة", "سنة", "تعريف", "معنى", "شرح", "المقصود", "التجريبي", "التجريبية",
    // Request verbs and pointers: how a question (or an instruction pasted
    // into one) asks, not what it asks about.
    "اشرح", "وضح", "بين", "اذكر", "اكتب", "أجب", "اجب", "اعتبر", "استشهد", "التالي", "التالية", "الإجابة", "الاجابة",
    "أريد", "اريد", "أعطني", "اعطني",
  ].flatMap((w) => [f(w), stemArabicWord(f(w)) || f(w)])
);

function topical(words: string[]): string[] {
  return words.filter((w) => !GENERIC.has(w));
}

/** The question with every law it names (kind + name words) removed. */
export function stripLawNames(question: string): string {
  // A dotted abbreviation ("ق.ع") is read as the law it stands for, and removed as one.
  const text = expandLawAbbreviations(question);
  const refs = extractAllLawReferences(text);
  if (refs.length === 0) return question;
  const toks = tokenize(text);
  const drop = new Set<number>();
  for (const ref of refs) {
    // The citation as written (kind, name, "رقم 8 لسنة 1996"), else kind + name.
    const words = ref.span ?? [...(ref.kind ? [ref.kind] : []), ...(ref.nameWords ?? ref.key.split(" "))];
    for (let i = 0; i < toks.length; i++) {
      const ok = words.every((w, k) => i + k < toks.length && (toks[i + k].folded === w || bareForms(toks[i + k].folded).includes(w)));
      if (ok) for (let k = 0; k < words.length; k++) drop.add(i + k);
    }
    // "القانون المدني" (definite form, no name words): drop the display words.
    if (ref.nameWords) continue;
    for (const w of ref.display.split(/\s+/)) {
      const fw = f(w);
      toks.forEach((t, i) => {
        if (t.folded === fw) drop.add(i);
      });
    }
  }
  let out = "";
  let cursor = 0;
  toks.forEach((t, i) => {
    if (!drop.has(i)) return;
    out += text.slice(cursor, t.start);
    cursor = t.end;
  });
  return (out + text.slice(cursor)).replace(/\s+/g, " ").trim();
}

export function questionNamesALaw(question: string): boolean {
  return extractAllLawReferences(question).length > 0;
}

/** Subject-matter stems of a question: its words minus the laws it names, question words and generic legal vocabulary. */
export function questionTopicStems(question: string): string[] {
  return [...new Set(topical(stems(stripLawNames(question))))];
}

/**
 * The same subject-matter words as surface forms, folded the way the keyword
 * index stores text (content_tsv is built on folded text with no stemming) —
 * for an OR keyword query scoped to a named law.
 */
export function questionTopicWords(question: string): string[] {
  const out = normText(stripLawNames(question))
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w) && !GENERIC.has(w) && !GENERIC.has(stemArabicWord(w) || w));
  return [...new Set(out)];
}

/**
 * The question's subject words as written (unfolded, clitics intact), for the
 * stem arm, whose index was built by stemming unfolded text: the stem OR-query
 * is made of these alone, not of every word of the question (an instruction
 * pasted into a question — "اعتبر النص التالي …" — otherwise ranked articles
 * by the instruction's words).
 */
export function questionTopicText(question: string): string {
  const keep = new Set(questionTopicWords(question));
  return tokenize(stripLawNames(question))
    .filter((t) => keep.has(normText(t.raw)))
    .map((t) => t.raw)
    .join(" ");
}

const BOILERPLATE_RE = /يسمي هذا (?:القانون|النظام|التعليمات)|ويعمل (?:به|بها) من تاريخ نشر|يعمل (?:به|بها) من تاريخ نشر/;
const ASKS_TITLE_RE = /يسمي|تسميه|اسم (?:هذا )?(?:القانون|النظام)|يعمل به|يعمل بها|نفاذ|سريان|تاريخ (?:العمل|النفاذ|السريان|النشر)|متي (?:صدر|نشر|يعمل)|when .*(?:effective|in force)/;

/** A short-title / commencement article: names the law and when it takes effect, states no rule. */
export function isBoilerplateArticle(text: string): boolean {
  const t = normText(text);
  return t.length < 400 && BOILERPLATE_RE.test(t);
}

export function asksAboutTitleOrCommencement(question: string): boolean {
  return ASKS_TITLE_RE.test(normText(question));
}

function withoutOwnLawName(c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title">): string {
  let t = normText(c.chunk_text);
  const names = [c.law_name, c.source_title?.replace(/\s+رقم\s+.*$/, "")].filter((n): n is string => !!n).map(normText);
  for (const n of names) if (n) t = t.split(n).join(" ");
  return t;
}

/**
 * Keys under which a light stem matches another word's (Phase 2.1). The light
 * stemmer (search/arabic-stem.ts) deliberately stops at clitics, so one
 * concept written two ways never met: a question's "تقادم دعوى الأجر" against
 * a statute's "تتقادم دعاوى … بالأجور" shared one word of four, and the
 * article was not admitted (held-out case hb-ret-10). Two words match when
 * they share a key:
 *   • the stem itself;
 *   • without an imperfect-verb prefix — "يهدد"/"هدد", "تتقادم"/"تقادم";
 *   • without a final ه — an attached pronoun or a folded ة: "غيره"/"غير",
 *     "عقوبه"/"عقوب(ات)";
 *   • a skeleton without inner long vowels, for broken plurals and verbal
 *     nouns — "عيوب"/"عيب", "أجور"/"أجر", "دعاوى"/"دعوى", "تهديد"/"هدد",
 *     "عقوبة"/"يعاقب";
 *   • a final hamza that took a seat under an attached pronoun ("إنهاؤه"/
 *     "إنهائه"/"إنهاء", "أداؤه"/"أداء") — an article saying "يجوز للمستأجر
 *     إنهاؤه … بإشعار" never met the question's "لإنهاء الإيجار" (case
 *     sec-inj-context, ranked 4th → 1st). The analogous ة → ت rule ("مدته"/
 *     "مدة") was measured and NOT adopted: "مدة" is so common in statutes that
 *     it admitted a second, weaker article in four evaluation cases.
 * For MATCHING two texts only (topic overlap, relevance), never for storage
 * or ranking: the looser keys can join words of one root that differ in
 * meaning, which is why a source still needs two shared subject words, not
 * one, to be admitted under the similarity floor.
 */
export function matchKeys(stem: string): string[] {
  const keys = new Set<string>([stem]);
  const bases = new Set<string>([stem]);
  if (stem.length >= 4 && /^[يت]/.test(stem)) bases.add(stem.slice(1));
  // An attached pronoun seats a final hamza: folded "إنهاؤه"/"إنهائه" are
  // "انهاوه"/"انهايه"; both map back to the bare "انهاء".
  for (const b of [...bases]) {
    const hamza = /^(.{2,}ا)[وي](?:ه|ها|هم|هما|هن)?$/.exec(b);
    if (hamza) bases.add(`${hamza[1]}ء`);
  }
  for (const b of [...bases]) if (b.length >= 4 && b.endsWith("ه")) bases.add(b.slice(0, -1));
  // Accusative tanween written as a final alef: "عاما"/"عام", "شهرا"/"شهر".
  for (const b of [...bases]) if (b.length >= 4 && b.endsWith("ا")) bases.add(b.slice(0, -1));
  for (const b of bases) {
    keys.add(b);
    if (b.length >= 3) {
      const skeleton = b[0] + b.slice(1, -1).replace(/[اوي]/g, "") + b[b.length - 1];
      // Verbal nouns of the تفعيل pattern ("تهديد") lose their ت as well.
      const bare = /^ت/.test(skeleton) && skeleton.length >= 4 ? skeleton.slice(1) : null;
      if (skeleton.length >= 2) keys.add(`~${skeleton}`);
      if (bare) keys.add(`~${bare}`);
    }
  }
  return [...keys];
}

function keySet(words: string[]): Set<string> {
  const out = new Set<string>();
  for (const w of words) for (const k of matchKeys(w)) out.add(k);
  return out;
}

/** The question's subject-matter stems the source contains (its own law name excluded when the question names the law). */
export function matchedTopicStems(
  question: string,
  c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title">,
  /** Stems of statutory synonyms the query expansion added for the question's concepts ("عقوبة" → "يعاقب"). */
  extraStems: string[] = []
): string[] {
  const topic = [...new Set([...questionTopicStems(question), ...extraStems])];
  if (topic.length === 0) return [];
  const text = questionNamesALaw(question) ? withoutOwnLawName(c) : `${normText(c.chunk_text)} ${normText(c.law_name ?? "")} ${normText(c.source_title ?? "")}`;
  const src = keySet(topical(stems(text)));
  // One question word counts once, whichever of its keys matched.
  return topic.filter((w) => matchKeys(w).some((k) => src.has(k)));
}

/**
 * The question's subject concepts: its topic stems plus the expansion's
 * statutory synonyms, with a synonym dropped when it is already a form of a
 * question word ("يعاقب" beside "عقوبة") — one concept is counted once.
 */
export function questionConcepts(question: string, extraStems: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of [...questionTopicStems(question), ...extraStems]) {
    const keys = matchKeys(w);
    if (keys.some((k) => seen.has(k))) continue;
    out.push(w);
    for (const k of keys) seen.add(k);
  }
  return out;
}

/** Which of `concepts` the source contains (its own law name excluded when the question names the law). */
export function matchConcepts(
  question: string,
  concepts: string[],
  c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title">
): string[] {
  if (concepts.length === 0) return [];
  const text = questionNamesALaw(question) ? withoutOwnLawName(c) : `${normText(c.chunk_text)} ${normText(c.law_name ?? "")} ${normText(c.source_title ?? "")}`;
  const src = keySet(topical(stems(text)));
  return concepts.filter((w) => matchKeys(w).some((k) => src.has(k)));
}

/** How many of the question's subject-matter stems the source contains. */
export function topicOverlapCount(
  question: string,
  c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title">,
  extraStems: string[] = []
): number {
  return matchedTopicStems(question, c, extraStems).length;
}

/**
 * Question words that most candidates contain (Phase 2.1): in a named law
 * the law's own subject ("عقوبة"/"يعاقب" in a penal code, "الإيجار" in a lease
 * law) is in nearly every article and tells them apart no better than the
 * law's name does. Such a word does not count toward admitting a source under
 * the similarity floor. Only decided from four or more candidates.
 */
export function commonTopicStems(matchedPerCandidate: string[][]): Set<string> {
  if (matchedPerCandidate.length < 4) return new Set();
  const df = new Map<string, number>();
  for (const m of matchedPerCandidate) for (const w of new Set(m)) df.set(w, (df.get(w) ?? 0) + 1);
  return new Set([...df].filter(([, n]) => n > matchedPerCandidate.length / 2).map(([w]) => w));
}

// "X عقد يلتزم بمقتضاه …", "X هو …": the head nouns a definition's predicate starts with.
const DEFINITION_PREDICATES = new Set(["عقد", "هو", "هي", "تصرف", "اتفاق", "اتفاقيه", "تمليك", "التزام", "حق", "كل", "كيان", "شخص", "واقعه", "فعل"]);
const DEFINITION_MARKER_RE = /(?:يقصد|يراد|يعني|تعني|يعرف|تعرف)\s+(?:ب|بـ)?\s*(\S+)|المعاني\s+المخصصه|حيثما\s+وردت/;

/**
 * Whether a source DEFINES the term a definition question asks about
 * (Phase 2.1): its text opens with the term followed by a defining predicate
 * ("الإيجار عقد يلتزم بمقتضاه المؤجر …"), or says "يقصد بـ<term>" / carries a
 * definitions list that names the term. Ranking only — a nudge among already
 * admitted sources, never admission.
 */
export function definesQuestionTerm(question: string, chunkText: string): boolean {
  const topic = questionTopicStems(question);
  if (topic.length === 0) return false;
  const keys = keySet(topic);
  const isTerm = (word: string) => matchKeys(stemArabicWord(word) || word).some((k) => keys.has(k));
  const body = normText(chunkText).replace(/^(?:ال)?ماده\s+\d+\s*/, "");
  const words = body.split(" ");
  if (words.length >= 2 && isTerm(words[0]) && DEFINITION_PREDICATES.has(words[1])) return true;
  const m = body.match(DEFINITION_MARKER_RE);
  if (m?.[1] && isTerm(m[1].replace(/^ب/, ""))) return true;
  if (m && !m[1]) return words.some((w) => isTerm(w)); // a definitions list that names the term
  return false;
}

/**
 * Lexical evidence strong enough to admit a source that the similarity floor
 * rejected, for a question that names no law (Phase 2.1): the source shares
 * at least three of the question's subject words, and at least half of them.
 * Before this, a natural-language question admitted nothing lexically — the
 * keyword arms required every word of it at once — so a paraphrase the vector
 * arm scored under the floor was answered "no evidence" although the article
 * repeated most of its words in another form (held-out hb-ret-14/15/16).
 */
export function hasLexicalEvidence(
  question: string,
  c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title">,
  /** Words most candidates share (commonTopicStems): they count neither way. */
  common: Set<string> = new Set()
): boolean {
  const n = questionTopicStems(question).filter((w) => !common.has(w)).length;
  if (n < 3) return false;
  const shared = matchedTopicStems(question, c).filter((w) => !common.has(w)).length;
  return shared >= Math.max(3, Math.ceil(n / 2));
}

/**
 * Whether a cited source bears on the question. Irrelevant when it is a
 * short-title/commencement article and the question is not about that, or
 * when the question has subject-matter words and the source shares none of
 * them (the law's own name does not count when the question named the law —
 * within that law every article "matches" it). An exact article/decision hit
 * the question asked for is always relevant.
 */
export function sourceIsRelevant(
  question: string,
  c: Pick<RetrievedChunk, "chunk_text" | "law_name" | "source_title" | "article_number" | "decision_number">,
  opts: { exactHit?: boolean } = {}
): boolean {
  if (opts.exactHit) return true;
  if (isBoilerplateArticle(c.chunk_text) && !asksAboutTitleOrCommencement(question)) return false;
  if (questionTopicStems(question).length === 0) return true; // a pure lookup ("ما نص المادة 17 من قانون العمل؟")
  return topicOverlapCount(question, c) > 0;
}

// ------------------------------------------------------------------ premises

/** The proposition a question takes for granted ("بما أن …", "لماذا …"), or null. */
export function extractPremise(question: string): string | null {
  const q = normalizeDigits(question).trim();
  const since = q.match(/(?:^|\s)(?:بما\s+(?:أن|ان)|حيث\s+(?:أن|ان|إن)|طالما\s+(?:أن|ان)|إذ\s+(?:أن|ان)|نظرا?ً?\s+(?:لأن|لان)|since|given\s+that)\s+([^،,؛?؟]+)/i);
  if (since) return since[1].replace(/\s+ف\S*$/, "").trim();
  const why = q.match(/^(?:لماذا|لِمَ|why)\s+([^?؟]+)/i);
  if (why) return why[1].trim();
  return null;
}

export type PremiseIssue = MeaningIssue;

/**
 * What a premise asserts that its source contradicts: figures the source does
 * not contain (ignoring the premise's own article/law/year numbers, which the
 * source's metadata carries), and the critical-term / polarity conflicts of
 * meaningConflicts.
 */
export function premiseConflicts(premise: string, sourceText: string, sourceNumbers: Set<number>): PremiseIssue[] {
  const issues: PremiseIssue[] = meaningConflicts(premise, sourceText);
  const own = numberValues(sourceText);
  for (const n of numberMentions(premise)) {
    if (sourceNumbers.has(n.value) || own.has(n.value)) continue;
    issues.push({ kind: "number", value: n.value });
  }
  return issues;
}
