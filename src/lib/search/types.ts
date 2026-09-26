export type RetrievedChunk = {
  id: number;
  source_id: number;
  source_title: string;
  source_type: string;
  chunk_text: string;
  article_number: string | null;
  law_name: string | null;
  law_number: string | null;
  /** الباب — structural context the article sits under. */
  part: string | null;
  /** الفصل. */
  chapter: string | null;
  /** الفرع / القسم. */
  section: string | null;
  court: string | null;
  decision_number: string | null;
  year: number | null;
  category: string | null;
  keywords: string[] | null;
  /** المواضيع القانونية — curated subject tags. */
  legal_topics: string[] | null;

  /** Cosine similarity, 0..1. Null when the row was found by keyword only. */
  vector_score: number | null;
  /** ts_rank / trigram score, 0..1. Null when found by vector only. */
  keyword_score: number | null;
  /**
   * ts_rank against the light-stemmed arm (arabic-stem.ts), 0..1. Null when
   * the row was not found by its stemmed form — most rows that were also
   * found by the exact keyword arm, since stemming only widens that match.
   */
  stem_score: number | null;
  /** Fused RRF score used for the final ordering. */
  score: number;
  matched_by: "vector" | "keyword" | "both";
  /**
   * Cross-encoder relevance, 0..1, when a reranker ran. Null means the order
   * came from RRF alone — the two are on different scales and must not be
   * compared or blended.
   */
  rerank_score?: number | null;

  // ---- provenance / version of the source this chunk belongs to (Phase 2) ----
  // Optional so fixtures and older call sites that build a RetrievedChunk by
  // hand stay valid; hybridSearch and getChunksByIds always populate them.
  /** False for a superseded / repealed version. The prompt labels it and grounding.ts flags an unlabelled use. */
  is_current_version?: boolean | null;
  /** ISO date the version took effect, when recorded. */
  effective_date?: string | null;
  /** ISO country code of the source (retrieval only serves JO). */
  jurisdiction?: string | null;
  /** official | secondary | synthetic | null (not recorded). */
  provenance?: string | null;
  is_synthetic?: boolean | null;
  source_url?: string | null;
  /** Number of stored chunks merged into this one (a long article split by the chunker, re-joined at retrieval). */
  merged_parts?: number;
};

/** Before/after record of a rerank pass, for logging and benchmarking. */
export type RerankTrace = {
  provider: string;
  model: string;
  candidates: number;
  /** RRF order handed to the reranker. */
  before: { id: number; title: string; article: string | null; rrfScore: number }[];
  /** Final order the reranker chose, with where each row came from. */
  after: { id: number; title: string; article: string | null; rerankScore: number; movedFrom: number }[];
};

export type SearchFilters = {
  category?: string;
  court?: string;
  year?: number;
  sourceType?: string;
  /**
   * Force inclusion of superseded / historical versions regardless of what the
   * question implies. For a deliberate "show me every version" UI toggle; the
   * default retrieval already returns only the current version.
   */
  includeHistorical?: boolean;
};
