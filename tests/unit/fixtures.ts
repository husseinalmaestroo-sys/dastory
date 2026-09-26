import type { RetrievedChunk } from "@/lib/search/types";

/**
 * Hand-built SYNTHETIC chunks for unit tests. The law names, numbers and
 * texts are invented ("التجريبي", year 2099) so no test can be mistaken for a
 * statement about real Jordanian law.
 */
export function chunk(over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 1,
    source_id: 1,
    source_title: "قانون الإيجار التجريبي رقم 7 لسنة 2099",
    source_type: "law",
    chunk_text:
      "المادة 12: يلتزم المؤجر بتسليم المأجور إلى المستأجر في الموعد المتفق عليه وبحالة صالحة للانتفاع. وإذا تأخر المؤجر في التسليم مدة تزيد على ثلاثين يوماً جاز للمستأجر فسخ العقد.",
    article_number: "12",
    law_name: "قانون الإيجار التجريبي",
    law_number: "7",
    part: null,
    chapter: null,
    section: null,
    court: null,
    decision_number: null,
    year: 2099,
    category: null,
    keywords: null,
    legal_topics: null,
    vector_score: 0.8,
    keyword_score: 0.2,
    stem_score: null,
    score: 0.05,
    matched_by: "both",
    is_current_version: true,
    effective_date: "2099-01-01",
    jurisdiction: "JO",
    provenance: "synthetic",
    is_synthetic: true,
    ...over,
  };
}

export const penalChunk = (over: Partial<RetrievedChunk> = {}) =>
  chunk({
    id: 2,
    source_id: 2,
    source_title: "قانون العقوبات التجريبي رقم 3 لسنة 2099",
    law_name: "قانون العقوبات التجريبي",
    law_number: "3",
    article_number: "40",
    chunk_text: "المادة 40: يعاقب بالحبس مدة لا تقل عن شهر كل من أتلف مال غيره عمداً، وبغرامة لا تتجاوز مئتي دينار.",
    ...over,
  });
