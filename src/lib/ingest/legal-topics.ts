import "server-only";
import { foldForSearch } from "./clean";

/**
 * Legal-topic tagging for a chunk — المواضيع القانونية.
 *
 * Distinct from `extractKeywords`, which is frequency-based and returns whatever
 * words happen to repeat. Topics are a fixed, curated vocabulary of Jordanian
 * legal subject areas, each recognised by a set of trigger terms. Tagging a
 * chunk with "مسؤولية مدنية" or "أوراق تجارية" gives retrieval and the source
 * card a stable, human-meaningful label that a raw word count cannot.
 *
 * Deliberately a dictionary, not a model call: it runs on every chunk at ingest
 * time, so it must stay free and deterministic. It is the seed of the Arabic
 * legal ontology — extend the table as the corpus grows; each new topic is one
 * entry and is covered the moment its triggers appear in a chunk.
 *
 * Matching is on folded text (foldForSearch), so orthographic variants
 * (إجراءات/اجراءات, مسؤولية/مسئولية) all hit the same trigger.
 */

/** topic label → trigger terms. Triggers are matched folded, as substrings. */
const TOPICS: [string, string[]][] = [
  ["التزامات وعقود", ["عقد", "التزام", "فسخ العقد", "بطلان", "مقاولة", "بيع", "ايجار", "إيجار", "هبة", "وكالة", "كفالة"]],
  ["مسؤولية مدنية", ["مسؤولية", "مسئولية", "ضرر", "تعويض", "خطا", "خطأ", "فعل ضار", "اثراء بلا سبب", "علاقة سببية"]],
  ["حقوق عينية", ["ملكية", "حق عيني", "رهن", "حيازة", "ارتفاق", "شفعة", "انتفاع"]],
  // "اجر"/"أجر" (bare) deliberately dropped from this topic's triggers: it is
  // the same root as "أجرة"/rent, so it was tagging real-estate/tenancy
  // articles as "عمل" purely on the shared root — "بدل الأجرة" (rent amount)
  // contains the substring "اجر" just as "أجر العامل" (the worker's wage)
  // does. The more specific phrases below still cover the labor concept.
  ["عمل", ["عامل", "صاحب العمل", "أجر العامل", "فصل تعسفي", "مكافاة نهاية الخدمة", "اصابة عمل", "استقالة", "عقد العمل", "ساعات العمل"]],
  ["شركات", ["شركة", "مساهمة", "مسؤولية محدودة", "حصص", "اسهم", "أسهم", "تصفية", "مدير الشركة", "راس المال", "مجلس الادارة"]],
  ["تجاري", ["تاجر", "تجاري", "شيك", "كمبيالة", "سند لامر", "سند سحب", "افلاس", "اوراق تجارية", "سجل تجاري"]],
  ["جزائي", ["جريمة", "عقوبة", "جناية", "جنحة", "حبس", "غرامة", "قصد جرمي", "شروع", "اساءة الامانة", "احتيال", "سرقة"]],
  ["أصول محاكمات", ["دعوى", "اختصاص", "طعن", "استئناف", "تمييز", "ميعاد", "تبليغ", "لائحة", "احكام", "تنفيذ الحكم"]],
  ["إثبات", ["بينة", "اثبات", "شهادة", "يمين", "قرينة", "اقرار", "خبرة", "عبء الاثبات"]],
  ["أحوال شخصية", ["زواج", "طلاق", "نفقة", "حضانة", "مهر", "ارث", "ميراث", "وصية", "خلع", "عدة"]],
  ["ضريبي", ["ضريبة", "دخل خاضع", "اقتطاع", "مكلف", "ضريبة المبيعات", "اعفاء ضريبي"]],
  ["تحكيم", ["تحكيم", "المحكم", "اتفاق التحكيم", "قرار التحكيم", "هيئة التحكيم"]],
  // Added alongside the 10 laws ingested 2026-07-19 (الملكية العقارية, حماية
  // المستهلك) — see legal-ontology.ts's matching expansion entries.
  ["عقاري", ["عقار", "مستأجر", "مؤجر", "المأجور", "بدل الإجارة", "بدل الايجار", "إخلاء المأجور", "اخلاء الماجور", "تسجيل الأراضي", "تسجيل الاراضي", "سند التسجيل", "رهن عقاري", "دائرة الأراضي والمساحة"]],
  ["حماية المستهلك", ["مستهلك", "المزود", "عيب السلعة", "اعلان مضلل", "حماية المستهلك"]],
];

// Pre-fold triggers once at module load, not per chunk.
const FOLDED: [string, string[]][] = TOPICS.map(([label, triggers]) => [
  label,
  triggers.map((t) => foldForSearch(t)),
]);

/**
 * True if `term` occurs in `folded` as a word, not buried inside a longer stem.
 *
 * A plain substring test false-positives badly in Arabic: "طلاق" (divorce) is a
 * substring of "الإطلاق" (absolutely), "بيع" (sale) of "طبيعة" (nature). The
 * fix cannot be `\b` (dead against Arabic) nor a strict non-letter boundary
 * (Arabic glues clitics — بـ/الـ/لـ/وـ — onto the front of words, so "للعامل"
 * must still match "عامل"). So: the char before the match must be a boundary OR
 * one of the single-consonant clitics و ف ب ك ل. That admits "الطلاق"/"بعقد"
 * (preceded by ل/ب) while rejecting "الإطلاق"/"طبيعة" (preceded by stem letters
 * ا/ط). Multi-word triggers are specific enough to test as a raw substring.
 */
export function containsTerm(folded: string, term: string): boolean {
  if (term.includes(" ")) return folded.includes(term);

  let from = 0;
  for (;;) {
    const i = folded.indexOf(term, from);
    if (i === -1) return false;
    const before = i === 0 ? "" : folded[i - 1];
    if (i === 0 || !/[؀-ۿ]/.test(before) || /[وفبكل]/.test(before)) return true;
    from = i + 1;
  }
}

/**
 * Returns the legal topics present in a chunk, most-triggered first, capped.
 * A topic counts when ANY of its triggers appears; ordering by trigger-hit
 * count puts the chunk's dominant subject first.
 */
export function extractLegalTopics(text: string, limit = 4): string[] {
  const folded = foldForSearch(text);
  const scored: [string, number][] = [];

  for (const [label, triggers] of FOLDED) {
    let hits = 0;
    for (const trig of triggers) if (containsTerm(folded, trig)) hits++;
    if (hits > 0) scored.push([label, hits]);
  }

  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label);
}
