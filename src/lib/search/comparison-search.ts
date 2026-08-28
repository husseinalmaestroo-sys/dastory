import "server-only";
import { hybridSearch } from "./hybrid";
import { expandQuery } from "./query-expansion";
import type { QueryType } from "./query-understanding";
import type { RetrievedChunk, SearchFilters } from "./types";
import type { ConfidenceResult } from "./confidence";

/**
 * Dedicated retrieval for detected comparison questions ("ما الفرق بين X و
 * Y؟") — runs ONE hybridSearch per side instead of a single fused query for
 * the whole question.
 *
 * WHY A SINGLE MERGED QUERY ISN'T ENOUGH ON ITS OWN
 *
 * Ontology expansion (legal-ontology.ts) already merges BOTH sides'
 * statutory vocabulary into one search text, and that alone measurably helps
 * (a chunk matching only side B's vocabulary can now clear the keyword arm).
 * But retrieval still fuses everything into ONE ranked list capped at topK,
 * so the two sides directly compete for the same slots — confirmed live
 * (2026-07-25): even with both sides' vocabulary merged, a single query for
 * "البطلان المطلق والبطلان النسبي" can still let side A's stronger lexical
 * footprint fill most or all of topK, leaving side B thin or absent with no
 * signal that anything was starved. Running a SEPARATE retrieval per side —
 * each with its own topK budget and its own relevance gate/confidence — is
 * the only way to actually guarantee both sides get a fair, independent shot,
 * and it is what lets the caller know (via confidenceA/confidenceB) exactly
 * which side came up short, instead of guessing from one blended number.
 *
 * The two calls run in parallel (Promise.all), so this costs roughly the
 * same wall-clock latency as one hybridSearch call — the price is one extra
 * embedding call and one extra DB round-trip, not 2x latency.
 */

export type ComparisonSearchResult = {
  /**
   * Merged, deduplicated, ordered sideA-first-then-sideB — this is what gets
   * numbered [1]..[n] in the prompt and is the SAME array every downstream
   * consumer (citation guard, self-verify, false-refusal retry) already
   * expects, so none of that machinery needs to know a comparison happened.
   */
  chunks: RetrievedChunk[];
  /** Which of `chunks` came from side A's own retrieval (may overlap chunksB). */
  chunksA: RetrievedChunk[];
  /** Which of `chunks` came from side B's own retrieval (may overlap chunksA). */
  chunksB: RetrievedChunk[];
  embeddingTokens: number;
  /**
   * The WORSE (lower-scoring) of the two sides' own confidence — a
   * comparison is only as trustworthy as its weaker-covered side, so this
   * can never be inflated by one strong side masking a starved other. See
   * confidence.ts for the label bands this score maps to.
   */
  confidence: ConfidenceResult;
  confidenceA: ConfidenceResult;
  confidenceB: ConfidenceResult;
  /** Union of both sides' expansion terms — same shape as Expansion.addedTerms, for the same "analysis" SSE payload and logging route.ts already builds. */
  addedTerms: string[];
};

const PER_SIDE_TOPK_RATIO = 0.75;
const MERGE_CAP_RATIO = 1.5;

async function searchSide(
  question: string,
  side: string,
  filters: SearchFilters,
  topK: number,
  ctx: { queryType?: QueryType; legalArea?: string | null },
  opts?: { allowLLM?: boolean }
) {
  // Side leads the combined text: expandQuery's ontology matching scans the
  // whole string for triggers regardless of position (matching against the
  // fuller text only ever ADDS candidate triggers, never removes one the side
  // alone would have matched), but when the LLM tier fires (doctrinal_question
  // with nothing from the free ontology tier — see query-expansion.ts) this
  // combined string is also its literal prompt input, and leading with the
  // side keeps its extraction focused on THIS concept specifically, with the
  // full question trailing as context for which comparison it sits in.
  const combined = `${side}. ${question}`;
  const expansion = await expandQuery(combined, { queryType: ctx.queryType ?? "doctrinal_question" }, opts);
  const result = await hybridSearch(question, filters, topK, {
    searchText: expansion.searchText,
    orGroup: expansion.orGroup,
    queryType: ctx.queryType,
    legalArea: ctx.legalArea,
  });
  return { ...result, addedTerms: expansion.addedTerms };
}

/** Lower score wins (a comparison is only as strong as its weakest side). */
function weaker(a: ConfidenceResult, b: ConfidenceResult): ConfidenceResult {
  const worse = a.score <= b.score ? a : b;
  return {
    ...worse,
    reason: `الطرف الأول: ${a.reason || "لا مصادر"} · الطرف الثاني: ${b.reason || "لا مصادر"}`,
  };
}

export async function comparisonSearch(
  question: string,
  sideA: string,
  sideB: string,
  filters: SearchFilters,
  topK: number,
  ctx: { queryType?: QueryType; legalArea?: string | null },
  opts?: { allowLLM?: boolean }
): Promise<ComparisonSearchResult> {
  const perSideTopK = Math.max(4, Math.round(topK * PER_SIDE_TOPK_RATIO));

  const [resA, resB] = await Promise.all([
    searchSide(question, sideA, filters, perSideTopK, ctx, opts),
    searchSide(question, sideB, filters, perSideTopK, ctx, opts),
  ]);

  const cap = Math.max(topK, Math.round(topK * MERGE_CAP_RATIO));

  // Fair interleave (A, B, A, B, ...) before the cap, so truncation can never
  // silently wipe out one side just because the other returned more raw
  // candidates — a naive "A's list then B's list, sliced to cap" would do
  // exactly that whenever A alone already fills the cap.
  const seen = new Set<number>();
  const merged: RetrievedChunk[] = [];
  const maxLen = Math.max(resA.chunks.length, resB.chunks.length);
  for (let i = 0; i < maxLen && merged.length < cap; i++) {
    if (resA.chunks[i] && !seen.has(resA.chunks[i].id)) {
      seen.add(resA.chunks[i].id);
      merged.push(resA.chunks[i]);
    }
    if (merged.length >= cap) break;
    if (resB.chunks[i] && !seen.has(resB.chunks[i].id)) {
      seen.add(resB.chunks[i].id);
      merged.push(resB.chunks[i]);
    }
  }

  return {
    chunks: merged,
    chunksA: resA.chunks,
    chunksB: resB.chunks,
    embeddingTokens: resA.embeddingTokens + resB.embeddingTokens,
    confidence: weaker(resA.confidence, resB.confidence),
    confidenceA: resA.confidence,
    confidenceB: resB.confidence,
    addedTerms: [...new Set([...resA.addedTerms, ...resB.addedTerms])],
  };
}
