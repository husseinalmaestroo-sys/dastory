import "server-only";
import { query, toVector } from "../db";
import { logError } from "../error-log";
import { getEmbeddingProvider } from "../ai";
import { env } from "../env";
import { foldForSearch } from "../ingest/clean";
import { normalizeQuery } from "./normalize";
import { getCachedEmbedding, setCachedEmbedding } from "./embedding-cache";
import { stemArabicText, stemArabicWord } from "./arabic-stem";
import { localRerank } from "./local-rerank";
import { parseIntent, resolveVersionScope } from "./intent";
import { extractLawReference, resolveLawSourceIds } from "./law-reference";
import { getRerankProvider } from "../ai/rerank";
import { resolveThresholds, gateChunk, computeConfidence, type ConfidenceResult } from "./confidence";
import type { QueryType } from "./query-understanding";
import type { RetrievedChunk, RerankTrace, SearchFilters } from "./types";

/**
 * legalArea (query-understanding.ts) → legal_topics labels (ingest/
 * legal-topics.ts) a chunk on that topic is expected to carry. Not every area
 * maps 1:1 — "مدني" spans both التزامات/مسؤولية topics, and "إجرائي" spans
 * أصول محاكمات AND إثبات — so this is a list, matched with array overlap
 * (&&), not equality.
 */
const AREA_TOPICS: Record<string, string[]> = {
  تجاري: ["تجاري"],
  جزائي: ["جزائي"],
  مدني: ["مسؤولية مدنية", "التزامات وعقود"],
  عمالي: ["عمل"],
  شركات: ["شركات"],
  "أحوال شخصية": ["أحوال شخصية"],
  إجرائي: ["أصول محاكمات", "إثبات"],
  تحكيم: ["تحكيم"],
  عقاري: ["عقاري", "حقوق عينية"],
  استهلاكي: ["حماية المستهلك"],
  ضريبي: ["ضريبي"],
};

// How deep each arm digs before fusion. Wider than topK on purpose: the whole
// value of fusion is a doc ranked #20 by vector and #3 by keyword surfacing,
// and that can't happen if each arm only returns its own top 8.
const ARM_LIMIT = 30;

// Reciprocal Rank Fusion constant. 60 is the value from the original RRF paper
// and it damps the difference between rank 1 and rank 2 enough that one arm
// being confidently wrong cannot bulldoze the other.
const RRF_K = 60;

// Dynamic score-gap cutoff (env.dynamicScoreGap, default off — see env.ts).
// Never cuts below this many candidates: the static per-type floor
// (confidence.ts) already screens for relevance, so this is only ever
// trimming an already-relevant list further, and 3 sources is little enough
// that trimming toward it risks starving a genuinely multi-source question.
const GAP_MIN_KEEP = 3;
// A candidate scoring under half of the one ranked immediately above it is a
// cliff, not a gentle taper — RRF/rerank scores otherwise decay smoothly, so
// this only fires on a real discontinuity, not a normal long tail.
const GAP_CLIFF_RATIO = 0.5;

/**
 * Trims a ranked list at the first big proportional drop between adjacent
 * candidates, so a smooth, uneventful tail is left alone while a genuine
 * cliff (a handful of clearly-relevant results, then a fall to noise) is not
 * padded out to topK with the noise. Generic over the score field because the
 * plain-RRF path and the post-rerank path sort by different scores
 * (`score` vs `rerank_score`), and applying the RRF score's gap to a
 * rerank-ordered list would be comparing the wrong numbers.
 */
function applyScoreGapCutoff<T>(list: T[], scoreOf: (item: T) => number): T[] {
  if (!env.dynamicScoreGap || list.length <= GAP_MIN_KEEP) return list;
  for (let i = GAP_MIN_KEEP; i < list.length - 1; i++) {
    const cur = scoreOf(list[i]);
    const next = scoreOf(list[i + 1]);
    if (cur > 0 && next / cur < GAP_CLIFF_RATIO) return list.slice(0, i + 1);
  }
  return list;
}

type Row = {
  id: number;
  source_id: number;
  chunk_text: string;
  article_number: string | null;
  law_name: string | null;
  law_number: string | null;
  part: string | null;
  chapter: string | null;
  section: string | null;
  court: string | null;
  decision_number: string | null;
  year: number | null;
  category: string | null;
  keywords: string[] | null;
  legal_topics: string[] | null;
  source_title: string;
  source_type: string;
  chunk_index: number;
  is_current_version: boolean | null;
  effective_date: string | null;
  jurisdiction: string | null;
  provenance: string | null;
  is_synthetic: boolean | null;
  source_url: string | null;
  vector_score: number | null;
  keyword_score: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  stem_score: number | null;
  stem_rank: number | null;
  exact_hit: boolean;
  topic_hit: boolean;
};

// All four arms now come back from one UNION ALL (see ARMS_SQL below),
// discriminated by `arm` — each branch only computes its own score, so full
// row data is fetched once, after fusion knows which ids actually matter, via
// FULL_ROW_SQL.
type ArmRow = { arm: "vec" | "kw" | "stem" | "exact"; id: number; score: number };
type FullRow = {
  id: number;
  source_id: number;
  chunk_text: string;
  article_number: string | null;
  law_name: string | null;
  law_number: string | null;
  part: string | null;
  chapter: string | null;
  section: string | null;
  court: string | null;
  decision_number: string | null;
  year: number | null;
  category: string | null;
  keywords: string[] | null;
  legal_topics: string[] | null;
  source_title: string;
  source_type: string;
  chunk_index: number;
  is_current_version: boolean | null;
  effective_date: string | null;
  jurisdiction: string | null;
  provenance: string | null;
  is_synthetic: boolean | null;
  source_url: string | null;
};

export type SearchResult = {
  chunks: RetrievedChunk[];
  embeddingTokens: number;
  /** Populated only when a reranker ran. Null on the plain RRF path. */
  rerankTrace?: RerankTrace | null;
  /** Backend-computed answer confidence. Never model-reported. */
  confidence: ConfidenceResult;
  /**
   * The law the question named ("قانون العمل"), when one was recognised —
   * the exact-article arm was scoped to it. Null when none was named.
   */
  lawReference?: { display: string; matchedSources: number } | null;
  /**
   * Set when the question names a law that is NOT in the corpus. The chat
   * pipeline answers "that law is not in the database" instead of letting
   * another law's article of the same number stand in for it.
   */
  requestedLawMissing?: string | null;
  /**
   * Set when an article number was asked for without naming a law, several
   * laws in the corpus have that article, and nothing else in the question
   * singled one out. The pipeline asks which law is meant (deterministic, no
   * model call) rather than answering from an arbitrary one.
   */
  articleAmbiguity?: { article: string; laws: string[] } | null;
};

export async function hybridSearch(
  question: string,
  filters: SearchFilters = {},
  topK = env.topK,
  /**
   * Query expansion, produced by search/query-expansion.ts:
   *   searchText — the question merged with statutory synonyms. Embedded ONCE
   *                (never one vector per term) so the query vector shifts
   *                toward the language the corpus actually uses.
   *   orGroup    — the same terms as a tsquery OR-group for the keyword arm.
   *                Kept separate from the websearch string on purpose:
   *                appending them there would AND them and match strictly
   *                fewer documents, which is the opposite of expanding.
   */
  expansion?: {
    searchText?: string;
    orGroup?: string;
    /**
     * Force a reranker for this call, overriding RERANK_PROVIDER. Used by the
     * benchmark to compare providers in one run; `{ provider: "none" }`
     * disables it explicitly.
     */
    rerank?: { provider?: string; model?: string };
    /**
     * From the query-understanding layer. Selects the relevance floor and the
     * confidence weighting — an article lookup and a fact pattern are judged by
     * different evidence, so they cannot share one threshold.
     */
    queryType?: QueryType;
    /**
     * From the query-understanding layer (analyzeQueryRules(question).legalArea).
     * Maps through AREA_TOPICS to the legal_topics labels a relevant chunk is
     * expected to carry — a SOFT ranking boost (topic_hit, below), never a
     * filter: a chunk with no topics or the "wrong" one still competes on
     * vector/keyword/stem alone, same principle as the inferred category/court
     * filters already being soft (see the SQL comment on $13-$15).
     */
    legalArea?: string | null;
  }
): Promise<SearchResult> {
  const provider = getEmbeddingProvider();

  // Defence in depth: route.ts already normalizes the question at the entry
  // point, but hybridSearch is also called directly (benchmarks, any future
  // internal caller) — idempotent, so normalizing again here costs nothing
  // when the caller already did it, and is not optional when they didn't.
  question = normalizeQuery(question);

  // Intent is parsed from the ORIGINAL question — article/decision numbers and
  // the court/year filters must come from what the lawyer actually asked, not
  // from terms the expansion added.
  const intent = parseIntent(question);

  // Which law, if any, the question names — scopes the exact-article arm and
  // detects a request for a law the corpus does not hold (law-reference.ts).
  const lawRef = env.lawScopedExact ? extractLawReference(question) : null;
  const lawSourceIds = lawRef ? await resolveLawSourceIds(lawRef) : null;
  const requestedLawMissing = lawRef && lawSourceIds && lawSourceIds.length === 0 ? lawRef.display : null;

  const searchText = expansion?.searchText?.trim() || question;
  const orGroup = expansion?.orGroup ?? "";

  // Reranking widens how deep the arms dig (50 candidates instead of 30) so the
  // cross-encoder (or the local composite reranker) has something to choose
  // from. When it is off, the depth stays exactly what it was — enabling this
  // feature cannot quietly alter the un-reranked results.
  //
  // "local" is search/local-rerank.ts — a free, synchronous, non-GPT reranker
  // (see its header for why), handled as its own branch below rather than
  // forced through the RerankProvider interface: that interface only takes
  // `documents: string[]`, but the local composite needs the full candidate
  // objects (fused score, legal_topics) to do anything an external API's
  // interface doesn't already give ai/rerank.ts's Cohere/Voyage classes.
  const rerankProviderName = (expansion?.rerank?.provider ?? env.rerankProvider).toLowerCase();
  const useLocalRerank = rerankProviderName === "local";
  const reranker = useLocalRerank ? null : getRerankProvider(expansion?.rerank);
  const armLimit = reranker || useLocalRerank ? env.rerankCandidates : ARM_LIMIT;

  // A repeat (or repeated-across-sessions) question skips the OpenAI
  // round-trip entirely — see embedding-cache.ts's header for why this is
  // safe with no invalidation logic: the cache key is the literal model
  // input, and a fixed text's embedding never goes stale.
  const cachedEmbedding = getCachedEmbedding(searchText, provider.model);
  let tokens = 0;
  let embeddingVector: number[];
  if (cachedEmbedding) {
    embeddingVector = cachedEmbedding;
  } else {
    const embedResult = await provider.embed([searchText], "query");
    embeddingVector = embedResult.embeddings[0];
    tokens = embedResult.tokens;
    setCachedEmbedding(searchText, embeddingVector, provider.model);
  }
  const queryVector = toVector(embeddingVector);
  const folded = foldForSearch(question);
  // stemArabicText wants ta-marbuta still intact (see arabic-stem.ts's header
  // comment), so it runs on `question` (already normalizeQuery'd, unfolded) —
  // NOT on `folded` above.
  const stemmed = stemArabicText(question);
  const topicHints = expansion?.legalArea ? (AREA_TOPICS[expansion.legalArea] ?? null) : null;

  // Filters come from the caller (UI dropdowns) first, then from what the
  // question itself implies.
  /**
   * Explicit filters (a UI dropdown) are HARD; filters merely inferred from the
   * question's wording are SOFT — they may narrow among rows that carry the
   * field, but never exclude rows where it is NULL.
   *
   * This is not a preference, it is a bug fix the benchmark surfaced. 65% of
   * chunks (2654/4061) have category NULL, and `d.category = $x` is false for
   * NULL — so a question containing "الدعوى الحقوقية" used to filter the corpus
   * down to a category that does not exist in it and return NOTHING. Six of
   * eight empty-retrieval cases in benchmark/legal-qa-100.json were this.
   */
  const explicitCategory = filters.category ?? null;
  const explicitCourt = filters.court ?? null;
  const explicitYear = filters.year ?? null;
  const inferredCategory = explicitCategory ? null : (intent.category ?? null);
  const inferredCourt = explicitCourt ? null : (intent.court ?? null);
  const inferredYear = explicitYear ? null : (intent.year ?? null);
  const sourceType = filters.sourceType ?? null;

  // Version scope is decided in code from the parsed intent — not by the model.
  // Default: current in-force version only. A dated ("as of 2015") or
  // explicitly-historical question lifts that and, if a year was given, caps by
  // effective_date. A UI toggle can force it via filters.includeHistorical.
  const scope = resolveVersionScope(intent);
  const currentOnly = filters.includeHistorical ? false : scope.currentOnly;
  const asOfDate = scope.asOfDate;

  const articleNumbers = intent.articleNumbers.length ? intent.articleNumbers : null;
  const decisionNumbers = intent.decisionNumbers.length ? intent.decisionNumbers : null;

  const armRows = await query<ArmRow>(ARMS_SQL, [
    queryVector,      // $1
    folded,           // $2
    orGroup,          // $3
    stemmed,          // $4
    armLimit,         // $5
    articleNumbers,   // $6
    decisionNumbers,  // $7
    explicitCategory, explicitCourt, explicitYear,     // $8-$10
    inferredCategory, inferredCourt, inferredYear,     // $11-$13
    sourceType, currentOnly, asOfDate,                 // $14-$16
    lawSourceIds,                                      // $17 exact arm scope (null = unscoped)
    env.allowSyntheticCorpus,                          // $18 synthetic fixtures allowed?
    env.legacyEmbeddingModel,                          // $19 model assumed for untagged vectors
    provider.model,                                    // $20 model of the query vector
  ]);

  // Rank within each arm from the score it returned — a plain ORDER BY...LIMIT
  // per UNION branch (see ARMS_SQL) already does the hard work of choosing
  // which armLimit rows matter; ranking them is just sorting what's already a
  // small, single arm's worth of rows, no reason to spend a SQL window
  // function (and a matching column type across all 4 branches) on it.
  const byArm = { vec: [] as ArmRow[], kw: [] as ArmRow[], stem: [] as ArmRow[], exact: [] as ArmRow[] };
  for (const r of armRows) byArm[r.arm].push(r);
  byArm.vec.sort((a, b) => b.score - a.score);
  byArm.kw.sort((a, b) => b.score - a.score);
  byArm.stem.sort((a, b) => b.score - a.score);

  const vecById = new Map(byArm.vec.map((r, i) => [r.id, { score: r.score, rank: i + 1 }]));
  const kwById = new Map(byArm.kw.map((r, i) => [r.id, { score: r.score, rank: i + 1 }]));
  const stemById = new Map(byArm.stem.map((r, i) => [r.id, { score: r.score, rank: i + 1 }]));
  const exactIds = new Set(byArm.exact.map((r) => r.id));

  const allIds = new Set<number>([...vecById.keys(), ...kwById.keys(), ...stemById.keys(), ...exactIds]);

  // Every arm came back empty — nothing to fetch, and nothing for the
  // relevance gate below to work with either.
  const fullRows = allIds.size
    ? await query<FullRow>(FULL_ROW_SQL, [[...allIds], env.allowSyntheticCorpus])
    : [];
  const fullById = new Map(fullRows.map((r) => [r.id, r]));

  const rows: Row[] = [...allIds].flatMap((id) => {
    const full = fullById.get(id);
    // A row an arm matched but that vanished before the lookup query ran
    // (deleted between the two round-trips) — theoretically possible, never
    // silently fabricated.
    if (!full) return [];
    const vec = vecById.get(id);
    const kw = kwById.get(id);
    const stem = stemById.get(id);
    return [{
      id: full.id,
      source_id: full.source_id,
      chunk_text: full.chunk_text,
      article_number: full.article_number,
      law_name: full.law_name,
      law_number: full.law_number,
      part: full.part,
      chapter: full.chapter,
      section: full.section,
      court: full.court,
      decision_number: full.decision_number,
      year: full.year,
      category: full.category,
      keywords: full.keywords,
      legal_topics: full.legal_topics,
      source_title: full.source_title,
      source_type: full.source_type,
      chunk_index: full.chunk_index,
      is_current_version: full.is_current_version,
      effective_date: full.effective_date,
      jurisdiction: full.jurisdiction,
      provenance: full.provenance,
      is_synthetic: full.is_synthetic,
      source_url: full.source_url,
      vector_score: vec?.score ?? null,
      keyword_score: kw?.score ?? null,
      vector_rank: vec?.rank ?? null,
      keyword_rank: kw?.rank ?? null,
      stem_score: stem?.score ?? null,
      stem_rank: stem?.rank ?? null,
      exact_hit: exactIds.has(id),
      // Soft boost, not a filter: no topicHints or a row with no legal_topics
      // both simply resolve to no bonus, never exclusion — same array-overlap
      // semantics as the old SQL's `&&`, just computed in JS now that the row
      // data and the hint list are both already in hand.
      topic_hit: !!(topicHints && full.legal_topics && full.legal_topics.some((t) => topicHints.includes(t))),
    }];
  });

  // An article number with no named law. When several laws have that
  // article, an exact row is boosted only if the rest of the question
  // (its words beyond "المادة N") actually occur in that row; if none does,
  // the question is ambiguous — the old code boosted up to 30 arbitrary
  // laws' copies to the top. (Arm membership cannot decide this: on a small
  // corpus the vector arm returns every row for any query.)
  const exactRows = rows.filter((r) => r.exact_hit);
  const exactLaws = new Set(exactRows.map((r) => r.source_id));
  const lawScoped = !!(lawSourceIds && lawSourceIds.length > 0);
  const context = articleContextStems(question);
  const supported = (r: Row) =>
    context.length > 0 && context.some((w) => rowStems(`${r.source_title} ${r.law_name ?? ""} ${r.chunk_text}`).has(w));
  const boostExact = (r: Row) => r.exact_hit && (lawScoped || exactLaws.size <= 1 || supported(r));
  const articleAmbiguity =
    !lawScoped && intent.articleNumbers.length > 0 && exactLaws.size >= 2 && !exactRows.some(supported)
      ? {
          article: intent.articleNumbers[0],
          laws: [...new Map(exactRows.map((r) => [r.source_id, r.source_title])).values()].slice(0, 12),
        }
      : null;

  const fused = rows
    .map((r) => {
      // RRF: score on rank position, not on raw score. Cosine similarity and
      // ts_rank live on incomparable scales — normalising them against each
      // other is guesswork, while ranks are directly comparable.
      let score = 0;
      if (r.vector_rank !== null) score += 1 / (RRF_K + r.vector_rank);
      if (r.keyword_rank !== null) score += 1 / (RRF_K + r.keyword_rank);
      // The stemmed arm: same rank-based fusion, so a chunk found only by
      // its stemmed form ("مستأجرين" against a query for "المستأجر") still
      // earns a place, without a stray bad stem (see arabic-stem.ts) ever
      // outweighing what the exact keyword or vector arm found.
      if (r.stem_rank !== null) score += 1 / (RRF_K + r.stem_rank);

      // An exact article/decision number match is not a ranking signal, it is
      // the answer. When a lawyer asks for المادة 202 they want المادة 202 at
      // the top, even if a semantically richer chunk exists.
      if (boostExact(r)) score += 1;

      // Soft topic-match bonus: the query-understanding layer already tags a
      // question's legal area for free, and legal_topics was sitting in the
      // schema, indexed, and completely unread by any query until now. Never
      // a filter — a chunk with no topic overlap just doesn't get the bonus.
      //
      // 0.015 ≈ one arm's own rank-1 contribution (1/(60+1) = 0.0164) —
      // genuinely a NUDGE, not a dominant term. A first attempt at 0.1 was a
      // calibration bug: with every per-arm contribution here capped at
      // 1/(60+1) ≈ 0.016 and decaying to ~1/(60+30) ≈ 0.011 by the bottom of
      // the arm, +0.1 was larger than THREE arms' combined maximum — it was
      // silently overriding vector+keyword+stem agreement entirely whenever
      // it fired, which scripts/benchmark-rerank.ts's "local" variant caught:
      // reranking a wide candidate pool dominated by same-topic-bonus ties
      // regressed MRR (0.953→0.875) by disrupting an ordering RRF had
      // actually gotten right. Re-measure after this fix before trusting
      // either the topic-boost or a reranker built on top of it.
      if (r.topic_hit) score += 0.015;

      const matched_by: RetrievedChunk["matched_by"] =
        r.vector_rank !== null && r.keyword_rank !== null
          ? "both"
          : r.vector_rank !== null
            ? "vector"
            : "keyword";

      return {
        id: r.id,
        source_id: r.source_id,
        source_title: r.source_title,
        source_type: r.source_type,
        chunk_text: r.chunk_text,
        article_number: r.article_number,
        law_name: r.law_name,
        law_number: r.law_number,
        part: r.part,
        chapter: r.chapter,
        section: r.section,
        court: r.court,
        decision_number: r.decision_number,
        year: r.year,
        category: r.category,
        keywords: r.keywords,
        legal_topics: r.legal_topics,
        chunk_index: r.chunk_index,
        is_current_version: r.is_current_version,
        effective_date: r.effective_date,
        jurisdiction: r.jurisdiction,
        provenance: r.provenance,
        is_synthetic: r.is_synthetic,
        source_url: r.source_url,
        vector_score: r.vector_score,
        keyword_score: r.keyword_score,
        stem_score: r.stem_score,
        score,
        matched_by,
        _exact: boostExact(r),
      };
    })
    .sort((a, b) => b.score - a.score);

  // Relevance gate. Without it, pgvector happily returns the 8 least-unrelated
  // chunks in the corpus for a question about a law we never uploaded, and the
  // model then has "sources" it feels obliged to answer from. This gate is what
  // actually produces the "لم أجد سنداً" path.
  //
  // The floor is now per query type (search/confidence.ts) rather than one flat
  // number: an article lookup and a fact pattern are answered by different
  // evidence and cannot share a threshold. Exact citation hits still bypass it.
  const thresholds = resolveThresholds(expansion?.queryType, {
    reranked: !!reranker || useLocalRerank,
    expanded: !!expansion?.orGroup,
  });
  const gated = fused.filter((c) => gateChunk(c, c._exact, thresholds));

  // Whether the lawyer's named citation was actually found — the single
  // strongest confidence signal for a lookup, so it is captured before the
  // internal flag is stripped off.
  const exactHit = gated.some((c) => c._exact);
  const ranked = gated.map(({ _exact, ...c }) => c);

  const confidenceFor = (chunks: RetrievedChunk[], reranked: boolean) =>
    computeConfidence(chunks, { queryType: expansion?.queryType, exactHit, reranked });

  const lawInfo = {
    lawReference: lawRef ? { display: lawRef.display, matchedSources: lawSourceIds?.length ?? 0 } : null,
    requestedLawMissing,
    articleAmbiguity,
  };
  // Confidence is computed on the retrieved chunks as ranked; article parts
  // are merged afterwards (a presentation step — it changes the text each
  // [n] carries, not which sources were found or how they scored).
  const finish = async (chunks: RetrievedChunk[], reranked: boolean, rerankTrace: RerankTrace | null): Promise<SearchResult> => ({
    chunks: env.mergeArticleParts ? await mergeArticleParts(chunks) : chunks,
    embeddingTokens: tokens,
    rerankTrace,
    confidence: confidenceFor(chunks, reranked),
    ...lawInfo,
  });

  // ---- plain RRF path (default) ----
  if (!reranker && !useLocalRerank) {
    return finish(applyScoreGapCutoff(ranked, (c) => c.score).slice(0, topK), false, null);
  }

  // ---- rerank path: wide candidates → (cross-encoder | local composite) → topK ----
  const candidates = ranked.slice(0, env.rerankCandidates);
  if (candidates.length <= 1) {
    return finish(candidates.slice(0, topK), false, null);
  }

  const rerankerName = useLocalRerank ? "local" : (reranker?.name ?? "unknown");
  const rerankerModel = useLocalRerank ? "composite-v1" : (reranker?.model ?? "unknown");

  try {
    // Both paths score against the lawyer's ACTUAL question, not the expanded
    // text: expansion exists to widen recall, while reranking — cross-encoder
    // or local composite — judges "does this passage answer what was asked",
    // and the added synonyms would blur that judgement. The local path is
    // synchronous (no network, no API key); awaiting a non-Promise is a no-op.
    const hits = useLocalRerank
      ? localRerank(question, candidates, topK, topicHints)
      : await reranker!.rerank(question, candidates.map((c) => c.chunk_text), topK);

    const before = candidates.map((c) => ({
      id: c.id,
      title: c.source_title,
      article: c.article_number,
      rrfScore: Number(c.score.toFixed(4)),
    }));

    const reordered = hits
      .filter((h) => h.index >= 0 && h.index < candidates.length)
      .map((h) => ({ ...candidates[h.index], rerank_score: h.score, _from: h.index }));

    const trace: RerankTrace = {
      provider: rerankerName,
      model: rerankerModel,
      candidates: candidates.length,
      before,
      after: reordered.map((c) => ({
        id: c.id,
        title: c.source_title,
        article: c.article_number,
        rerankScore: Number((c.rerank_score ?? 0).toFixed(4)),
        movedFrom: c._from,
      })),
    };

    console.log(
      `[rerank] ${rerankerName}/${rerankerModel}: ${candidates.length} → ${reordered.length}` +
        ` | before: ${before.slice(0, 5).map((b) => `#${b.id}(${b.rrfScore})`).join(" ")}` +
        ` | after: ${trace.after.slice(0, 5).map((a) => `#${a.id}(${a.rerankScore})←${a.movedFrom}`).join(" ")}`
    );

    // Gap cutoff on rerank_score, NOT the stale RRF `score` — the reranker
    // just re-sorted this list by rerank_score, so that is the scale a
    // discontinuity has to be measured on.
    const trimmed = applyScoreGapCutoff(reordered, (c) => c.rerank_score ?? 0);
    return finish(trimmed.slice(0, topK).map(({ _from, ...c }) => c), true, trace);
  } catch (err) {
    // Reranking is a refinement, never a dependency. A failed call must not
    // cost the lawyer their answer — fall back to the RRF order and say so.
    // Confidence is computed as UN-reranked, because it was: reporting a
    // cross-encoder's endorsement that never happened would overstate it.
    logError(`[rerank] ${rerankerName} failed, falling back to RRF order:`, err);
    return finish(applyScoreGapCutoff(candidates, (c) => c.score).slice(0, topK), false, null);
  }
}

/**
 * Filter conditions shared by every arm below — explicit (UI) filters hard,
 * inferred-from-wording filters soft (a row with no category, 65% of the
 * corpus, must never be excluded by a guess made from the question's
 * phrasing — see the "استرجاع فارغ" bug this fixed), plus the legal-versioning
 * gate, all scoped to `legal_documents d` alone via an uncorrelated subquery
 * against the small `legal_sources` table instead of a join. All four arms in
 * ARMS_SQL below share one param list now (there is only one query), so this
 * is a plain string, not a per-arm offset function — $8-$16 are fixed.
 */
const FILTER_FRAGMENT = `
     AND ($8::text  IS NULL OR d.category = $8)
     AND ($9::text  IS NULL OR d.court    = $9)
     AND ($10::int  IS NULL OR d.year     = $10)
     AND ($11::text IS NULL OR d.category = $11 OR d.category IS NULL)
     AND ($12::text IS NULL OR d.court    = $12 OR d.court    IS NULL)
     AND ($13::int  IS NULL OR d.year     = $13 OR d.year     IS NULL)
     AND d.source_id IN (
       SELECT id FROM legal_sources
        WHERE status = 'ready'
          -- Phase 2: Jordanian sources only, and synthetic evaluation
          -- fixtures only when ALLOW_SYNTHETIC_CORPUS=true — a fixture loaded
          -- into production by mistake can never be quoted as law.
          AND jurisdiction = 'JO'
          AND (is_synthetic = false OR $18::boolean)
          AND ($14::text IS NULL OR source_type = $14)
          AND ($15::boolean IS NOT TRUE OR is_current_version = TRUE)
          AND ($16::date IS NULL OR effective_date IS NULL OR effective_date <= $16::date)
     )`;

/**
 * Four independent arms, combined with UNION ALL into ONE round-trip.
 *
 * This went through two designs before this one, both measured:
 *   1. The original single query shared one `filtered` CTE across all arms.
 *      Referenced four times, Postgres materialised it, and every index in
 *      the schema went silently unused — the vector arm scanned-and-sorted
 *      the entire filtered set instead of using the HNSW index, same for the
 *      GIN indexes on the keyword/stem arms. Confirmed with EXPLAIN ANALYZE
 *      (scripts/tmp-explain-hybrid.ts): a full sort over ~4.3k rows per arm,
 *      only cheap at today's corpus size and exactly the "past ~100k chunks
 *      this will dominate latency" the old comment here predicted.
 *   2. Splitting into four separate queries (one per arm, no shared CTE) DID
 *      get each arm its index back (confirmed again with EXPLAIN ANALYZE:
 *      `Index Scan using idx_documents_embedding`, `Bitmap Index Scan on
 *      idx_documents_tsv[_stemmed]`) — but traded that for four separate
 *      network round-trips, and measured SLOWER end-to-end at today's small
 *      corpus (510-534ms vs the original's 429-448ms) because round-trip
 *      count dominated at this scale even though each query itself was now
 *      near-instant.
 * This design gets both: each UNION branch is independently planned (a
 * branch is not materialised just because it sits inside a UNION ALL, unlike
 * a CTE referenced by multiple siblings), so the same indexes apply, but it
 * costs exactly one round-trip. Measured (scripts/tmp-explain-union.ts):
 * 84-88ms warm, faster than both prior designs.
 *
 * No ROW_NUMBER() here on purpose: each branch's own ORDER BY...LIMIT is what
 * lets the planner pick an index in the first place, and a window function
 * on top of that would only have to agree on a common column type across all
 * four UNION branches for no benefit — ranking a single arm's already-small,
 * already-fetched result set is a trivial JS-side sort (see the call site).
 *
 * Every branch repeats FILTER_FRAGMENT rather than sharing it via a CTE —
 * that repetition is exactly what keeps each branch independently plannable.
 */
const ARMS_SQL = `
  (SELECT 'vec'::text AS arm, d.id, (1 - (d.embedding <=> $1::vector))::real AS score
     FROM legal_documents d
    WHERE d.embedding IS NOT NULL
      -- Only vectors from the model that embedded the query: two models of
      -- the same width would otherwise mix silently after a model change.
      -- Untagged (pre-Phase-2) rows count as LEGACY_EMBEDDING_MODEL.
      AND COALESCE(d.embedding_model, $19::text) = $20::text
      ${FILTER_FRAGMENT}
    ORDER BY d.embedding <=> $1::vector
    LIMIT $5)
  UNION ALL
  -- The keyword query. When the expansion added terms ($3), the statutory
  -- synonyms are OR'd onto the lawyer's own wording (the || operator between
  -- two tsqueries is OR) so a document matching only the statutory phrasing
  -- still surfaces, without making the original terms harder to satisfy.
  (SELECT 'kw'::text AS arm, d.id, ts_rank(d.content_tsv, kwq.q)::real AS score
     FROM legal_documents d,
          LATERAL (
            SELECT CASE
                     WHEN $3::text IS NULL OR $3::text = ''
                       THEN websearch_to_tsquery('simple', $2)
                     ELSE websearch_to_tsquery('simple', $2) || to_tsquery('simple', $3::text)
                   END AS q
          ) kwq
    WHERE d.content_tsv @@ kwq.q
      ${FILTER_FRAGMENT}
    ORDER BY score DESC
    LIMIT $5)
  UNION ALL
  -- Third arm: the SAME question, light-stemmed (search/arabic-stem.ts),
  -- against content_tsv_stemmed. Postgres's 'simple' config has no Arabic
  -- stemmer (see schema.sql), so "المستأجرين"/"للمستأجر"/"مستأجر" tokenise as
  -- three unrelated words in the kw arm above; this arm is where they collide
  -- on one token instead. plainto_tsquery, not websearch_to_tsquery: stemmed
  -- text is already reduced to bare space-joined stems. The $4::text <> ''
  -- check makes an empty stemmed string a no-op branch rather than
  -- special-cased out of the query, same trick the original single-query
  -- design used.
  (SELECT 'stem'::text AS arm, d.id, ts_rank(d.content_tsv_stemmed, stemq.q)::real AS score
     FROM legal_documents d,
          LATERAL (SELECT plainto_tsquery('simple', $4) AS q) stemq
    WHERE $4::text <> '' AND d.content_tsv_stemmed @@ stemq.q
      ${FILTER_FRAGMENT}
    ORDER BY score DESC
    LIMIT $5)
  UNION ALL
  -- Citation lookups: fetched regardless of what the ranked arms found. Score
  -- is meaningless here (always 0) — fusion only ever checks arm === 'exact'
  -- membership, never this column, for this branch.
  -- Phase 2: when the question names a law, the article match is scoped to
  -- that law's sources ($17); ordered so the LIMIT is deterministic instead
  -- of an arbitrary 30 of the corpus's same-numbered articles.
  (SELECT 'exact'::text AS arm, d.id, 0::real AS score
     FROM legal_documents d
    WHERE (($6::text[] IS NOT NULL AND d.article_number  = ANY($6)
             AND ($17::bigint[] IS NULL OR d.source_id = ANY($17::bigint[])))
        OR ($7::text[] IS NOT NULL AND d.decision_number = ANY($7)))
      ${FILTER_FRAGMENT}
    ORDER BY d.source_id, d.chunk_index
    LIMIT $5)
`;

// Fetches the full row for exactly the ids fusion needs — a plain primary-key
// membership check, the cheapest possible query shape, run once no matter how
// many arms matched a given id.
const FULL_ROW_SQL = `
  SELECT d.id, d.source_id, d.chunk_text, d.article_number, d.law_name, d.law_number,
         d.part, d.chapter, d.section, d.court, d.decision_number, d.year, d.category,
         d.keywords, d.legal_topics, s.title AS source_title, s.source_type, d.chunk_index,
         s.is_current_version, s.effective_date::text AS effective_date, s.jurisdiction,
         s.provenance, s.is_synthetic, s.source_url
    FROM legal_documents d
    JOIN legal_sources s ON s.id = d.source_id
   WHERE d.id = ANY($1::bigint[])
     -- Same served-corpus rule as the arms: also guards getChunksByIds,
     -- whose ids come from a client (draft refine).
     AND s.jurisdiction = 'JO'
     AND (s.is_synthetic = false OR $2::boolean)
`;

/** Reorders `rows` to match `ids` exactly; silently drops any id with no
 *  matching row (deleted or reindexed since). Pure — no DB — so it's
 *  unit-testable without a connection. */
export function orderChunksByIds<T extends { id: number }>(rows: T[], ids: number[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * Re-fetches full chunk rows for an EXISTING numbered source list (the
 * `sources` array `/api/draft` already returned) — used by
 * `/api/draft/refine` so a refined section's [n] means the exact same source
 * as the rest of that draft's [n], never a fresh retrieval. Score fields are
 * placeholders (no ranking happened here); safe because formatSources() only
 * reads the content fields, never score/matched_by.
 */
export async function getChunksByIds(ids: number[]): Promise<RetrievedChunk[]> {
  if (ids.length === 0) return [];
  const fullRows = await query<FullRow>(FULL_ROW_SQL, [ids, env.allowSyntheticCorpus]);
  const chunks: RetrievedChunk[] = fullRows.map((full) => ({
    ...full,
    vector_score: null,
    keyword_score: null,
    stem_score: null,
    score: 0,
    matched_by: "keyword" as const,
  }));
  return orderChunksByIds(chunks, ids);
}

// ---------------------------------------------------------------- article parts

/** Cap on a merged article's text: long enough for any ordinary article with its provisos, short enough that eight sources still fit a prompt. */
const MAX_MERGED_CHARS = 6000;

type PartRow = { id: number; source_id: number; chunk_index: number; article_number: string; chunk_text: string };

/**
 * Joins `b` onto `a`, dropping the overlap the chunker's sliding window
 * repeats at the start of each continuation part (chunk.ts's OVERLAP_CHARS,
 * snapped to a word boundary — so the exact overlap length varies; the
 * longest suffix of `a` that prefixes `b`, up to 400 chars, is removed).
 */
export function joinWithOverlap(a: string, b: string): string {
  const max = Math.min(400, a.length, b.length);
  for (let len = max; len >= 20; len--) {
    if (a.endsWith(b.slice(0, len))) return `${a}${b.slice(len)}`;
  }
  return `${a}\n${b}`;
}

/**
 * Re-joins an article the chunker split into sliding-window parts (chunk.ts:
 * articles over MAX_CHARS). Retrieval scores the parts separately — the part
 * that matched the question wins — but a part can hold a rule while its
 * exception, proviso or penalty sits in the next part. Handing the model one
 * part detached the condition from the rule it modifies. Each retrieved part
 * is therefore replaced by its whole article (all contiguous parts of the
 * same source + article number, in order, overlap removed), and a second
 * retrieved part of an article already present is dropped, so [n] still
 * denotes one source. Pure text assembly: no scores change.
 */
export async function mergeArticleParts(chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  const keyed = chunks.filter((c) => c.article_number);
  if (keyed.length === 0) return chunks;
  const parts = await query<PartRow>(
    `SELECT id, source_id, chunk_index, article_number, chunk_text
       FROM legal_documents
      WHERE source_id = ANY($1::bigint[]) AND article_number = ANY($2::text[])
      ORDER BY source_id, chunk_index`,
    [[...new Set(keyed.map((c) => c.source_id))], [...new Set(keyed.map((c) => c.article_number!))]]
  );
  return mergeArticlePartsFrom(chunks, parts);
}

/** The pure half of mergeArticleParts (unit-tested without a database). */
export function mergeArticlePartsFrom(chunks: RetrievedChunk[], parts: PartRow[]): RetrievedChunk[] {
  const groups = new Map<string, PartRow[]>();
  for (const p of parts) {
    const k = `${Number(p.source_id)}|${p.article_number}`;
    const list = groups.get(k) ?? [];
    list.push({ ...p, id: Number(p.id), source_id: Number(p.source_id), chunk_index: Number(p.chunk_index) });
    groups.set(k, list);
  }

  const seenArticles = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const c of chunks) {
    if (!c.article_number) {
      out.push(c);
      continue;
    }
    const k = `${Number(c.source_id)}|${c.article_number}`;
    if (seenArticles.has(k)) continue; // another part of an article already included
    seenArticles.add(k);

    const group = (groups.get(k) ?? []).sort((a, b) => a.chunk_index - b.chunk_index);
    const at = group.findIndex((p) => p.id === Number(c.id));
    if (group.length <= 1 || at === -1) {
      out.push(c);
      continue;
    }
    // Only the contiguous run around the retrieved part: the same article
    // number appearing again later in the source (a repeated number in a
    // badly numbered text) is a different article.
    let lo = at;
    let hi = at;
    while (lo > 0 && group[lo - 1].chunk_index === group[lo].chunk_index - 1) lo--;
    while (hi < group.length - 1 && group[hi + 1].chunk_index === group[hi].chunk_index + 1) hi++;
    if (lo === hi) {
      out.push(c);
      continue;
    }
    let text = group[lo].chunk_text;
    for (let i = lo + 1; i <= hi; i++) text = joinWithOverlap(text, group[i].chunk_text);
    if (text.length > MAX_MERGED_CHARS) {
      // Too long to carry whole: keep the retrieved part with as much of its
      // neighbours as fits, marked as an excerpt.
      const own = group[at].chunk_text;
      const start = Math.max(0, text.indexOf(own.slice(0, 200)) - Math.floor((MAX_MERGED_CHARS - own.length) / 2));
      text = `…${text.slice(start, start + MAX_MERGED_CHARS)}…`;
    }
    out.push({ ...c, chunk_text: text, merged_parts: hi - lo + 1 });
  }
  return out;
}

// ---------------------------------------------------------------- article-lookup context

// Words that carry no identifying content in an article lookup.
const LOOKUP_STOP = new Set(
  ["ما", "هو", "هي", "نص", "تنص", "ينص", "عليه", "الذي", "التي", "حكم", "اشرح", "شرح", "معني", "مضمون", "ماده", "الماده",
   "المواد", "في", "من", "علي", "عن", "بشان", "حول", "هل", "قانون", "القانون", "نظام", "النظام", "رقم", "لسنه", "و", "او", "اريد", "اعطني"].map((w) =>
    foldForSearch(w)
  )
);

/** Stemmed content words of a question outside its article reference. */
export function articleContextStems(question: string): string[] {
  const rest = foldForSearch(question).replace(/(?:ال)?ماد[ةه]\s*[({[]?\s*\d+[)}\]]?/g, " ");
  return [
    ...new Set(
      rest
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !LOOKUP_STOP.has(w))
        .map((w) => stemArabicWord(w) || w)
    ),
  ];
}

function rowStems(text: string): Set<string> {
  return new Set(
    foldForSearch(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1)
      .map((w) => stemArabicWord(w) || w)
  );
}
