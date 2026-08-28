import "server-only";
import { stemArabicText } from "./arabic-stem";
import { cleanText } from "../ingest/clean";
import type { RetrievedChunk } from "./types";

/**
 * Free, local, non-GPT reranker.
 *
 * WHY THIS EXISTS INSTEAD OF JUST TURNING ON COHERE/VOYAGE
 *
 * `ai/rerank.ts` already wires a real cross-encoder reranker (Cohere,
 * Voyage) — but both need a paid API key, and neither is configured here
 * (no COHERE_API_KEY / VOYAGE_API_KEY in .env). And the brief for this
 * retrieval pass is explicit: do not solve retrieval problems with GPT — so a
 * "call gpt-4o-mini to judge relevance" reranker is off the table too, for
 * the same reason `search/confidence.ts` computes confidence from measured
 * signals instead of asking the model to grade itself.
 *
 * WHAT IT ACTUALLY ADDS OVER PLAIN RRF
 *
 * RRF (hybrid.ts) fuses RANKS — position 3 on the vector arm and position 3
 * on the keyword arm score identically regardless of how much better either
 * match actually was. This reranker looks at the WIDE candidate set's
 * content directly and adds two things rank alone cannot see:
 *
 *   1. Lexical overlap MAGNITUDE — a Jaccard score between the stemmed query
 *      terms and the stemmed chunk terms. A chunk sharing 6 of the
 *      question's 8 content words is a better answer than one sharing 2,
 *      even if both cleared the keyword arm's floor and RRF cannot
 *      distinguish them.
 *   2. Topic overlap COUNT — how many of the query's expected legal_topics
 *      (search/hybrid.ts's AREA_TOPICS) a chunk actually carries, not just
 *      whether it carries at least one (which is all the RRF-stage
 *      topic_hit boost can express).
 *
 * These are blended with the chunk's existing fused RRF score (normalised
 * 0..1 across just this candidate set) rather than replacing it — the RRF
 * score already encodes the exact-citation bonus and the vector/keyword/stem
 * agreement, and throwing that away to rebuild relevance from scratch would
 * discard real signal for no reason.
 *
 * Deterministic and synchronous — no network call, no API key, nothing to
 * time out. scripts/benchmark-rerank.ts's "local" variant is what proves
 * whether this composite actually beats plain RRF before it becomes default.
 *
 * MEASURED (2026-07-19), AND IT DOES NOT — SHIPS OFF BY DEFAULT
 *
 * benchmark/rerank-eval.json, 16 cases: baseline (RRF only) hit@8 16/16, MRR
 * 0.953, mean rank 1.19, ranked #1 in 15/16. This reranker: hit@8 16/16
 * (same), but MRR 0.911, mean rank 1.31, #1 in 14/16 — a regression the
 * script's own verdict calls correctly ("تراجع — لا تفعّله"). It moved the
 * SAME chunk that was already ranked #1 down to #2+ in a few cases rather
 * than fixing a genuine miss — hit@K stayed perfect in both, so nothing was
 * newly FOUND, something already correct just got reordered worse.
 *
 * Diagnosed, not just accepted: the "before" RRF scores handed to this
 * reranker are frequently near-ties (many candidates land within ~0.001 of
 * each other, deep in the wide 50-candidate pool used only when reranking is
 * on) — RRF's own tie-break in that regime apparently correlates with
 * something real that Jaccard term-overlap among near-duplicate chunks from
 * the same article does not capture, and re-sorting on the overlap+topic
 * blend then loses it. (An earlier run also caught a genuine calibration bug
 * this way — hybrid.ts's topic_hit bonus was 0.1, larger than the RRF
 * fusion's entire per-arm range, until this benchmark's regression pointed at
 * it; fixed to 0.015. The result above is POST-fix and still a regression.)
 *
 * So: available via RERANK_PROVIDER=local for experimentation, same posture
 * `ai/rerank.ts` already established for Cohere/Voyage — off until a
 * benchmark says otherwise, not on the strength of the design argument above.
 * n=16 (article-level subset n=6) is small enough that this verdict could
 * still flip with a larger eval set or retuned W_FUSED/W_OVERLAP/W_TOPIC
 * weights; re-run scripts/benchmark-rerank.ts --variant=local before ever
 * flipping the default.
 */

export type LocalRerankHit = { index: number; score: number };

const W_FUSED = 0.55;
const W_OVERLAP = 0.35;
const W_TOPIC = 0.1;

// Below this length a stemmed token is more likely noise (a stray clitic
// remnant) than a real content word — same floor arabic-stem.ts's own
// MIN_STEM_LEN uses for the same reason.
const MIN_TOKEN_LEN = 2;

function tokenSet(stemmedText: string): Set<string> {
  return new Set(stemmedText.split(/\s+/).filter((w) => w.length >= MIN_TOKEN_LEN));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Linear rescale to 0..1 across the candidate set; a flat set maps to 1 (no discrimination lost). */
function minMaxScaler(values: number[]): (v: number) => number {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < 1e-9) return () => 1;
  return (v) => (v - lo) / (hi - lo);
}

/**
 * Scores each candidate against the question and returns the top N, ordered
 * best-first — same contract shape as ai/rerank.ts's RerankProvider, so
 * hybrid.ts can slot this in without a different result-handling path.
 *
 * @param topicHints the legal_topics labels this query's detected legalArea
 *   expects (hybrid.ts's AREA_TOPICS) — null when no area was detected.
 */
export function localRerank(
  question: string,
  candidates: RetrievedChunk[],
  topN: number,
  topicHints: string[] | null
): LocalRerankHit[] {
  if (candidates.length === 0) return [];

  const qTokens = tokenSet(stemArabicText(cleanText(question)));
  const scaleFused = minMaxScaler(candidates.map((c) => c.score));

  const scored = candidates.map((c, index) => {
    const overlap = jaccard(qTokens, tokenSet(stemArabicText(c.chunk_text)));

    let topicScore = 0;
    if (topicHints?.length && c.legal_topics?.length) {
      const hits = c.legal_topics.filter((t) => topicHints.includes(t)).length;
      // Cap the denominator at 2: a chunk matching 2+ of the expected topics
      // is already a full topic-relevance signal, and dividing by however
      // many topics the area happens to map to (1 to 2 in AREA_TOPICS today)
      // would otherwise reward a broad area less than a narrow one for the
      // same single match.
      topicScore = Math.min(1, hits / Math.min(2, topicHints.length));
    }

    const score = W_FUSED * scaleFused(c.score) + W_OVERLAP * overlap + W_TOPIC * topicScore;
    return { index, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
