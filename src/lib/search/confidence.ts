import "server-only";
import { env } from "../env";
import type { QueryType } from "./query-understanding";
import type { RetrievedChunk } from "./types";

/**
 * Dynamic relevance gating and answer confidence — computed in the backend,
 * never asked of the model.
 *
 * WHY NOT ASK GPT
 *
 * The same reason guard.ts redacts citations instead of requesting good
 * behaviour: a model asked "how confident are you?" produces a fluent number
 * that tracks its own tone, not the evidence. Confidence here is a function of
 * things we actually measured — what the retriever scored, whether a
 * cross-encoder agreed, how many independent sources cleared the gate, and
 * whether the citation the lawyer named was found verbatim. All of that is
 * known before the model writes a word.
 *
 * WHY THE FIXED 0.3 THRESHOLD HAD TO GO
 *
 * Measured over 23 probe queries against the live corpus (166 sources / 4061
 * chunks, text-embedding-3-small):
 *
 *   on-topic question   top vector score   0.458 – 0.643   (median ~0.55)
 *   off-topic question  no rows at all     0.000
 *   article_lookup      MEAN of top-8      0.113 – 0.124   ← note this
 *
 * So `minScore = 0.3` sat below everything and filtered nothing: 30 of 30
 * candidates cleared it on almost every query. Worse, it is the wrong shape of
 * control for a lookup — when a lawyer asks for المادة 6, the exact-numbered
 * chunk wins on an exact match and its cosine similarity is often LOW (the
 * question is six words, the article is a paragraph). Holding lookups to a
 * vector floor would discard the one row that answers them. Hence: the floor
 * varies by query type, and exact citation hits bypass it entirely.
 */

export type ConfidenceLabel = "عالية" | "متوسطة" | "منخفضة" | "لا يوجد";

export type ConfidenceFactors = {
  /** Strength of the best result (rerank score when reranked, else vector). */
  relevance: number;
  /** How many independent sources cleared the gate. */
  corroboration: number;
  /** An exact article/decision citation was found verbatim. */
  exactness: number;
  /** Share of results both arms independently surfaced. */
  agreement: number;
};

export type ConfidenceResult = {
  /** 0..1, rounded to 3 dp. */
  score: number;
  label: ConfidenceLabel;
  factors: ConfidenceFactors;
  /** Human-readable, Arabic, for the UI badge tooltip. */
  reason: string;
};

export type GateThresholds = {
  minVectorScore: number;
  minKeywordScore: number;
  /**
   * ts_rank floor for the light-stemmed arm (search/arabic-stem.ts). Same
   * scale as minKeywordScore (both are ts_rank against a 'simple'-config
   * tsvector) so it reuses that floor rather than needing its own tuned
   * constant — the stemmed arm is the same ranking function over a
   * normalised copy of the same text, not a different scoring method.
   */
  minStemScore: number;
  /** Type this gate was resolved for, for logging. */
  queryType: QueryType | "unknown";
};

/**
 * Score band used to normalise a vector score into 0..1.
 *
 * Measured, not chosen — and deliberately WIDER than the observed on-topic
 * range. text-embedding-3-small does not spread Arabic legal text much: every
 * on-topic question in the probe set landed between 0.458 and 0.643. Anchoring
 * the band to that range exactly (first attempt: 0.45→0.62) turned those 0.19
 * points into the entire 0..1 scale, so a perfectly good labour question at
 * 0.478 reported "منخفضة". Widening to 0.40→0.60 keeps the ordering while
 * making the low end mean "weak", not merely "not the best of a good set".
 *
 * Re-measure if the embedding model changes: these are properties of
 * text-embedding-3-small on this corpus, not universal constants.
 */
const VEC_WEAK = 0.4;
const VEC_STRONG = 0.6;

/** Rerank scores are already calibrated 0..1 by the cross-encoder. */
const RERANK_WEAK = 0.2;
const RERANK_STRONG = 0.8;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const band = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo));

/**
 * The per-type relevance floor.
 *
 * Every value is ABOVE the old flat 0.3 (which filtered nothing) and BELOW the
 * weakest on-topic top score observed (0.458), so tightening the gate cannot
 * wipe out a legitimate question's results — it trims the tail that used to
 * reach the model unchallenged.
 *
 *   article_lookup     — exact hits bypass this entirely (see gateChunk). What
 *                        remains is padding, so it is held to the highest bar.
 *   legal_definition   — one concept, one answer; a loose match is noise.
 *   doctrinal_question — comparisons legitimately span several articles.
 *   fact_pattern       — widest net. Lay wording depresses similarity against
 *                        statutory text (the whole reason expansion exists), so
 *                        the floor drops and the burden moves to confidence:
 *                        a fact pattern with weak scores and no corroboration
 *                        reports low confidence rather than being silently cut.
 */
const TYPE_FLOOR: Record<QueryType, { vector: number; keyword: number }> = {
  article_lookup: { vector: 0.45, keyword: 0.05 },
  // Was 0.40, lowered to 0.36 on benchmark evidence. Across three runs of
  // benchmark/legal-qa-100.json the 0.40 floor produced ZERO recall gains and
  // cost two cases outright — civ-03 (البينات، شهادة الشهود) and cri-17
  // (العقوبات، أسباب الإباحة), both legal_definition questions whose best chunk
  // scores in the 0.36–0.40 gap, both dropping to n=0. A floor that only ever
  // removes correct answers is not a filter, it is a leak.
  legal_definition: { vector: 0.36, keyword: 0.05 },
  doctrinal_question: { vector: 0.36, keyword: 0.05 },
  fact_pattern: { vector: 0.32, keyword: 0.04 },
  drafting_request: { vector: 0.36, keyword: 0.05 },
  contract_review: { vector: 0.36, keyword: 0.05 },
};

/**
 * Resolves the gate for a query.
 *
 * @param ctx.reranked   a cross-encoder will re-sort the candidates, so the
 *                       floor can afford to be looser — the reranker, not the
 *                       cosine, decides what survives.
 * @param ctx.expanded   the query carried statutory synonyms, so a keyword-only
 *                       hit is more likely to be a real match than a stray word.
 */
export function resolveThresholds(
  queryType: QueryType | undefined,
  ctx: { reranked?: boolean; expanded?: boolean } = {}
): GateThresholds {
  const floor = queryType ? TYPE_FLOOR[queryType] : { vector: 0.36, keyword: 0.05 };

  let vector = floor.vector;
  let keyword = floor.keyword;

  // A reranker reads the question and the passage together; it is a strictly
  // better filter than a cosine cutoff, so widen the funnel feeding it.
  if (ctx.reranked) vector -= 0.04;
  // Expansion terms are statutory vocabulary we deliberately injected — a
  // lexical hit on one is meaningful, so accept them a little more readily.
  if (ctx.expanded) keyword -= 0.01;

  // RETRIEVAL_MIN_SCORE stays honoured as a global override, but only to
  // TIGHTEN: an operator who raises it gets a stricter system, while the
  // default 0.3 is below every floor above and therefore inert, exactly as it
  // already was in practice.
  vector = Math.max(vector, env.minScore);

  return {
    minVectorScore: vector,
    minKeywordScore: Math.max(0, keyword),
    minStemScore: Math.max(0, keyword),
    queryType: queryType ?? "unknown",
  };
}

/**
 * Whether a single fused chunk clears the gate.
 *
 * An exact citation hit is not scored, it is ANSWERED: when the lawyer names
 * المادة 421 and that article exists, it belongs in the results whatever its
 * cosine similarity says.
 */
export function gateChunk(
  c: Pick<RetrievedChunk, "vector_score" | "keyword_score" | "stem_score">,
  isExact: boolean,
  t: GateThresholds
): boolean {
  if (isExact) return true;
  if (c.vector_score !== null && c.vector_score >= t.minVectorScore) return true;
  if (c.keyword_score !== null && c.keyword_score >= t.minKeywordScore) return true;
  // Without this, a chunk found ONLY through its stemmed form ("مستأجرين"
  // against a search for "المستأجر") — no vector match, no exact keyword
  // match — would be computed into the fused score and then discarded right
  // here anyway, since neither check above ever looks at stem_score. That
  // would make the whole stemmed arm additive to ranking but inert for
  // recall, which defeats the reason it exists.
  return c.stem_score !== null && c.stem_score >= t.minStemScore;
}

/**
 * Weighting per query type. "article_lookup: exact match أهم شيء" is expressed
 * here literally — for a lookup, finding the named article is nearly half the
 * confidence, while for a concept question there is no citation to match and
 * the weight moves to how strongly the corpus actually answered.
 *
 * `agreement` is capped low everywhere on purpose: measured on this corpus the
 * two arms overlap on 0 results for 21 of 23 probe queries, so treating arm
 * agreement as a major term would report low confidence for everything.
 */
const WEIGHTS: Record<QueryType, ConfidenceFactors> = {
  // Exactness outweighs everything else here by design. A lookup's exact-match
  // chunk carries a LOW cosine as a rule (measured: mean top-8 of 0.113–0.124,
  // because a six-word question is compared against a full article), so letting
  // relevance carry real weight would penalise precisely the outcome we want.
  // Finding the named article IS the answer.
  article_lookup: { relevance: 0.2, corroboration: 0.15, exactness: 0.55, agreement: 0.1 },
  legal_definition: { relevance: 0.55, corroboration: 0.25, exactness: 0.1, agreement: 0.1 },
  doctrinal_question: { relevance: 0.55, corroboration: 0.25, exactness: 0.1, agreement: 0.1 },
  fact_pattern: { relevance: 0.5, corroboration: 0.3, exactness: 0.1, agreement: 0.1 },
  drafting_request: { relevance: 0.55, corroboration: 0.25, exactness: 0.1, agreement: 0.1 },
  contract_review: { relevance: 0.55, corroboration: 0.25, exactness: 0.1, agreement: 0.1 },
};

/** Enough independent sources that agreement between them means something. */
const CORROBORATION_TARGET = 5;

export function computeConfidence(
  chunks: RetrievedChunk[],
  ctx: { queryType?: QueryType; exactHit?: boolean; reranked?: boolean }
): ConfidenceResult {
  const zero: ConfidenceFactors = { relevance: 0, corroboration: 0, exactness: 0, agreement: 0 };
  if (chunks.length === 0) {
    return { score: 0, label: "لا يوجد", factors: zero, reason: "لم يُسترجع أي مصدر من قاعدة البيانات." };
  }

  const w = ctx.queryType ? WEIGHTS[ctx.queryType] : WEIGHTS.doctrinal_question;

  // Relevance: the best single result. Rerank and vector scores live on
  // different scales and are never blended — whichever ran, its own band is
  // used.
  const reranked = ctx.reranked && chunks.some((c) => c.rerank_score != null);
  const relevanceRaw = reranked
    ? band(Math.max(...chunks.map((c) => c.rerank_score ?? 0)), RERANK_WEAK, RERANK_STRONG)
    : band(Math.max(...chunks.map((c) => c.vector_score ?? 0)), VEC_WEAK, VEC_STRONG);

  const corroborationRaw = clamp01(chunks.length / CORROBORATION_TARGET);
  const exactnessRaw = ctx.exactHit ? 1 : 0;
  const agreementRaw = chunks.filter((c) => c.matched_by === "both").length / chunks.length;

  const factors: ConfidenceFactors = {
    relevance: relevanceRaw * w.relevance,
    corroboration: corroborationRaw * w.corroboration,
    exactness: exactnessRaw * w.exactness,
    agreement: agreementRaw * w.agreement,
  };

  const score = clamp01(factors.relevance + factors.corroboration + factors.exactness + factors.agreement);
  // Cut points chosen against the measured distribution so the labels partition
  // real questions rather than bunching them: on this corpus a median on-topic
  // concept question lands ~0.65 (متوسطة — sources found, verify them), a
  // strongly-answered one ~0.80 (عالية), and a single weak source ~0.22
  // (منخفضة). "عالية" is meant to be earned, not typical.
  const label: ConfidenceLabel = score >= 0.7 ? "عالية" : score >= 0.45 ? "متوسطة" : "منخفضة";

  const bits: string[] = [];
  if (ctx.exactHit) bits.push("طابق رقم المادة المطلوب");
  bits.push(reranked ? "أعاد المرتِّب الدلالي ترتيب النتائج" : `أعلى تطابق دلالي ${(Math.max(...chunks.map((c) => c.vector_score ?? 0))).toFixed(2)}`);
  bits.push(`${chunks.length} مصدر مسترجَع`);
  if (agreementRaw > 0) bits.push("تطابق البحثان الدلالي واللفظي");

  return { score: Number(score.toFixed(3)), label, factors, reason: bits.join(" · ") };
}
