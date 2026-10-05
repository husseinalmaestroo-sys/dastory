import type { AuthorityLevel, SourceClass } from './engine-schema'

/**
 * What the interface may say about a legal source (corpus repair, 2026-10).
 * Each label states a recorded fact and nothing more: "from an official
 * source" is not "compared with the Official Gazette", and neither is
 * "verified". The engine decides the level (corpus/integrity.ts); this file
 * only words it. No label here may claim more than its level.
 */
export const AUTHORITY_LABEL_AR: Record<AuthorityLevel, string> = {
  gazette_verified: 'قورن نصه بالمنشور في الجريدة الرسمية',
  official_not_verified: 'من جهة نشر رسمية — لم يُقارن بالجريدة الرسمية',
  secondary_not_verified: 'من مصدر ثانوي — لم يُقارن بالجريدة الرسمية',
  unrecorded_not_verified: 'مصدره غير مسجّل — لم يُقارن بالجريدة الرسمية',
  synthetic: 'نص اختباري — ليس قانوناً',
}

export const SOURCE_CLASS_LABEL_AR: Record<SourceClass, string> = {
  legislation: 'تشريع',
  regulation: 'نظام',
  instruction: 'تعليمات',
  interpretation: 'قرار تفسيري (الديوان الخاص)',
  court_decision: 'قرار قضائي',
  mou: 'مذكرة تفاهم',
  secondary: 'مادة ثانوية',
}

type Labelled = { cited?: boolean; authorityLevel?: AuthorityLevel | null }

const LEVEL_ORDER: AuthorityLevel[] = ['gazette_verified', 'official_not_verified', 'secondary_not_verified', 'unrecorded_not_verified', 'synthetic']

/**
 * One line on the sources an answer cites: how many, and for each authority
 * level among them what may be said — e.g. "2 مصدر: 1 من جهة نشر رسمية — لم
 * يُقارن بالجريدة الرسمية؛ 1 من مصدر ثانوي — لم يُقارن بالجريدة الرسمية".
 * A citation without a level (an older engine) counts as not compared.
 */
export function citedSourcesLabel(sources: Labelled[]): string {
  const cited = sources.filter((s) => s.cited)
  if (cited.length === 0) return 'لا يستشهد بمصدر'
  const counts = new Map<AuthorityLevel, number>()
  for (const s of cited) {
    const level = s.authorityLevel ?? 'unrecorded_not_verified'
    counts.set(level, (counts.get(level) ?? 0) + 1)
  }
  const parts = LEVEL_ORDER.filter((l) => counts.has(l)).map((l) => `${counts.get(l)} ${AUTHORITY_LABEL_AR[l]}`)
  return `${cited.length} مصدر: ${parts.join('؛ ')}`
}

/** The badge for each answer mode. Never "موثّق": a grounded answer is grounded in the database's text, whatever that text's standing. */
export const MODE_LABEL_AR: Record<string, { type: 'go' | 'pe' | 'ur'; label: string }> = {
  grounded: { type: 'go', label: 'مُسند إلى نص من قاعدة البيانات' },
  grounded_retry: { type: 'go', label: 'مُسند إلى نص من قاعدة البيانات' },
  partial: { type: 'pe', label: 'مُسند جزئياً' },
  sources_only: { type: 'pe', label: 'نصوص مسترجعة دون إجابة مُتحقَّق منها' },
  general: { type: 'pe', label: 'إجابة عامة — بلا استشهاد' },
  clarification: { type: 'pe', label: 'يحتاج السؤال إلى توضيح' },
  no_evidence: { type: 'ur', label: 'لم يُعثر على سند' },
  refused: { type: 'ur', label: 'لم يُعثر على سند' },
  law_not_in_corpus: { type: 'ur', label: 'القانون غير موجود في قاعدة البيانات' },
  law_unavailable: { type: 'ur', label: 'نص القانون محجوب — لم يجتز فحص سلامة النص' },
  article_not_in_corpus: { type: 'ur', label: 'المادة غير موجودة في النص المحفوظ' },
  decision_not_in_corpus: { type: 'ur', label: 'القرار غير موجود في قاعدة البيانات' },
  out_of_jurisdiction: { type: 'ur', label: 'خارج نطاق القانون الأردني' },
  blocked: { type: 'ur', label: 'طلب مرفوض' },
}
