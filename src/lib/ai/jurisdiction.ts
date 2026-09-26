import "server-only";
import { foldForSearch } from "../ingest/clean";

/**
 * JURISDICTION CONTROL (Phase 2, step 22).
 *
 * The corpus is Jordanian law only (retrieval filters jurisdiction = 'JO').
 * A question about another country's law must not be answered from
 * Jordanian sources as if they applied — nor from the model's memory of
 * foreign law. This detects a question that is ABOUT a foreign legal system
 * (not one that merely mentions a foreign person: "عامل مصري في الأردن" is a
 * Jordanian-law question).
 *
 * Detection is by phrasing, deliberately narrow: a legal-system noun
 * followed by a foreign nationality adjective ("القانون المصري", "نظام العمل
 * السعودي", "المحاكم الإماراتية"), "في <country>" ("عقوبة السرقة في مصر"), or
 * the English equivalents. A question that also names Jordan is a comparison:
 * answered for Jordan only, with an explicit notice.
 */

export type JurisdictionCheck =
  | { kind: "jordan" }
  | { kind: "foreign"; mentioned: string[] }
  | { kind: "comparison"; mentioned: string[] };

// Folded adjective stems (masculine; feminine/definite forms derived below).
const ADJECTIVES: Record<string, string> = {
  مصري: "مصر", سعودي: "السعودية", اماراتي: "الإمارات", كويتي: "الكويت", قطري: "قطر", بحريني: "البحرين",
  عماني: "عُمان", لبناني: "لبنان", سوري: "سوريا", عراقي: "العراق", فلسطيني: "فلسطين", ليبي: "ليبيا",
  تونسي: "تونس", جزايري: "الجزائر", مغربي: "المغرب", سوداني: "السودان", يمني: "اليمن", فرنسي: "فرنسا",
  بريطاني: "بريطانيا", انجليزي: "إنجلترا", امريكي: "الولايات المتحدة", الماني: "ألمانيا", تركي: "تركيا",
  ايراني: "إيران", اسرايلي: "إسرائيل",
};
const COUNTRIES: Record<string, string> = {
  مصر: "مصر", السعوديه: "السعودية", الامارات: "الإمارات", الكويت: "الكويت", قطر: "قطر", البحرين: "البحرين",
  عمان: "عُمان", لبنان: "لبنان", سوريا: "سوريا", العراق: "العراق", ليبيا: "ليبيا", تونس: "تونس",
  الجزاير: "الجزائر", المغرب: "المغرب", السودان: "السودان", اليمن: "اليمن", فرنسا: "فرنسا", بريطانيا: "بريطانيا",
  انجلترا: "إنجلترا", امريكا: "الولايات المتحدة", المانيا: "ألمانيا", تركيا: "تركيا", ايران: "إيران",
};
// "عمان" is also Amman (Jordan's capital) once folded — only the adjective
// form counts for Oman; "في عمان" stays Jordanian.
const AMBIGUOUS_COUNTRY = new Set(["عمان"]);

const LEGAL_NOUNS =
  "(?:ال)?(?:قانون|قوانين|تشريع|تشريعات|نظام|انظمه|محاكم|محكمه|قضاء|دستور|مشرع|القانون|التشريع|النظام|المحاكم|المحكمه|القضاء|الدستور|المشرع)";

const EN_FOREIGN =
  /\b(egypt(?:ian)?|saudi(?: arabia)?|u\.?a\.?e\.?|emirat(?:es|i)|kuwait(?:i)?|qatar(?:i)?|bahrain(?:i)?|oman(?:i)?|leban(?:on|ese)|syria(?:n)?|iraq(?:i)?|palestin(?:e|ian)|liby(?:a|an)|tunisia(?:n)?|algeria(?:n)?|morocc(?:o|an)|sudan(?:ese)?|yemen(?:i)?|france|french|british|english law|u\.?k\.?|united kingdom|american|u\.?s\.? law|united states|german(?:y)?|turk(?:ey|ish)|iran(?:ian)?|israel(?:i)?)\b/i;
const EN_LEGAL_CONTEXT = /\b(law|laws|legislation|code|court|courts|statute|regulation|jurisdiction|legal system)\b/i;
const JORDAN_RE = /الاردن|اردني|jordan/i;

function feminineForms(adj: string): string[] {
  return [adj, `${adj}ه`, `${adj}ة`, `ال${adj}`, `ال${adj}ه`, `ال${adj}ة`];
}

export function checkJurisdiction(question: string): JurisdictionCheck {
  const q = foldForSearch(question);
  const mentioned = new Set<string>();

  for (const [adj, country] of Object.entries(ADJECTIVES)) {
    const forms = feminineForms(adj).join("|");
    // legal noun, up to three words, then the adjective: "نظام العمل السعودي".
    const re = new RegExp(`${LEGAL_NOUNS}(?:\\s+[^\\s]+){0,3}\\s+(?:${forms})(?![\\p{L}])`, "u");
    if (re.test(q)) mentioned.add(country);
  }
  for (const [folded, country] of Object.entries(COUNTRIES)) {
    if (AMBIGUOUS_COUNTRY.has(folded)) continue;
    const re = new RegExp(`(?:^|\\s)(?:في|ب|لدي|داخل)\\s*${folded}(?![\\p{L}])|${LEGAL_NOUNS}\\s+${folded}(?![\\p{L}])`, "u");
    if (re.test(q)) mentioned.add(country);
  }
  const en = question.match(EN_FOREIGN);
  if (en && EN_LEGAL_CONTEXT.test(question)) mentioned.add(en[1]);

  if (mentioned.size === 0) return { kind: "jordan" };
  return JORDAN_RE.test(q) ? { kind: "comparison", mentioned: [...mentioned] } : { kind: "foreign", mentioned: [...mentioned] };
}

export const COMPARISON_NOTICE_AR =
  "تنبيه: قاعدة البيانات لا تشمل إلا التشريعات الأردنية؛ الإجابة التالية تقتصر على القانون الأردني ولا تتناول القانون الأجنبي المذكور في السؤال.";

/** True when the text is mostly Latin script (an English question gets English system messages). */
export function isMostlyLatin(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  return latin > arabic;
}
