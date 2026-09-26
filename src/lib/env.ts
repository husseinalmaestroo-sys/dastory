import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got: ${v}`);
  return n;
}

/**
 * Every field is a getter, not a value.
 *
 * `next build` imports every route module to collect its config, which would
 * run any top-level validation — so eager checks here fail the build on any
 * machine without a populated .env, including CI and the Docker image build.
 * Getters move the check to first actual use, at request time, where a missing
 * key is a real error and the message reaches whoever can fix it.
 *
 * The key-reading getters are also why chat and embeddings can use different
 * vendors without either one's key being mandatory: `anthropicApiKey` only
 * throws if something actually asks Claude for an answer.
 */
export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },

  // ---- chat ----
  get chatProvider() {
    return process.env.CHAT_PROVIDER ?? "openai";
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get chatModel() {
    return process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  },
  /**
   * The model self-verify.ts's judge call uses — deliberately separate from
   * `chatModel`/`anthropicModel`. A compact JSON classification pass has a
   * different cost/quality bar than the answer a lawyer actually reads, and
   * defaulting the judge to whatever flagship model the operator picks for
   * the visible answer would be an invisible cost multiplier riding along
   * with that decision, not a deliberate one. Provider-aware because a model
   * ID only means something within the provider that serves it — an OpenAI
   * model ID sent to the Anthropic client (or vice versa) is just an error.
   */
  get verifierModel() {
    const override = process.env.VERIFIER_MODEL;
    if (override) return override;
    if (this.chatProvider === "test") return "test-extractive-v1";
    return this.chatProvider === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini";
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
  },

  // ---- embeddings ----
  // Deliberately no "anthropic" option: Claude has no embeddings endpoint.
  get embeddingProvider() {
    return process.env.EMBEDDING_PROVIDER ?? "openai";
  },
  get voyageApiKey() {
    return required("VOYAGE_API_KEY");
  },
  get embeddingModel() {
    return process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  },
  get embeddingDim() {
    return num("EMBEDDING_DIM", 1536);
  },

  // ---- reranking ----
  /**
   * Cross-encoder reranker: cohere | voyage | none. Defaults to "none", so the
   * retrieval pipeline is unchanged until a benchmark justifies switching it
   * on — see scripts/benchmark-rerank.ts.
   */
  get rerankProvider() {
    return process.env.RERANK_PROVIDER ?? "none";
  },
  /** Overrides the provider's default model (rerank-multilingual-v3.0 / rerank-2). */
  get rerankModel() {
    return process.env.RERANK_MODEL ?? null;
  },
  get cohereApiKey() {
    return required("COHERE_API_KEY");
  },
  /**
   * How many fused candidates are handed to the reranker. Only applies when
   * reranking is on; with it off the arms keep their original narrower depth,
   * so enabling this cannot silently change the un-reranked results.
   */
  get rerankCandidates() {
    return num("RERANK_CANDIDATES", 50);
  },

  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
  get lawyerSessionSecret() {
    return required("LAWYER_SESSION_SECRET");
  },
  get ipHashSalt() {
    return required("IP_HASH_SALT");
  },

  /**
   * Shared secret for trusted server-to-server callers (e.g. Dostoori's
   * backend, calling on behalf of one of its own authenticated, tenant-scoped
   * users). Deliberately optional and unset by default — this app is fully
   * usable standalone with no caller ever able to present it. When a caller
   * presents X-Internal-Service-Key matching this value (see lawyer-auth.ts's
   * requireLawyer), it is trusted to have already done its OWN auth/tenant/
   * rate-limit checks upstream; every check below that point (per-caller rate
   * limit, site/per-caller cost cap, guard.ts, self-verify.ts) still runs
   * exactly as it does for a lawyer signed in through the normal cookie flow.
   */
  get internalServiceKey() {
    return process.env.INTERNAL_SERVICE_KEY ?? null;
  },

  // ---- cost guardrails ----
  /**
   * USD/day a single client may spend before every further paid request from
   * it (chat, case-upload analysis, drafting) is refused until the day rolls
   * over (UTC). Keyed on IP hash, not the lawyer/session identity: the lawyer
   * gate (lawyer-auth.ts) is a name+phone form with no password, and
   * registering a new one is only rate-limited (8/hour/IP — see
   * lawyer/register/route.ts), not eliminated, so a script can still mint a
   * handful of fresh lawyer identities per hour per IP. IP hash is the one
   * thing that survives both a cleared cookie and a freshly registered name.
   * Sized from this app's own measured chat_history: the busiest real
   * session-day so far asked 13 grounded questions (~$0.11 at current gpt-4o
   * pricing); $2/day leaves generous headroom above any real lawyer's day
   * while still bounding one abusive IP's worst case to a small, predictable
   * number. See costcap.ts.
   */
  get costCapPerUserUsd() {
    return num("COST_CAP_PER_USER_USD", 2);
  },
  /**
   * USD/day the WHOLE site may spend, across every user, before every paid
   * request anywhere is refused until the day rolls over — the circuit
   * breaker for distributed abuse (many IPs) or a genuine traffic spike, not
   * just one bad actor. Unlike costCapPerUserUsd, there is no launched
   * traffic yet to size this against (dev/test usage only as of writing) —
   * treat this default as a starting judgment call, not a measured figure,
   * and revisit it once real usage volume exists. Setting it to 0 is a hard
   * kill switch: every paid endpoint refuses immediately.
   */
  get costCapSiteUsd() {
    return num("COST_CAP_SITE_USD", 20);
  },
  /**
   * USD/day ONE Dostoori office may spend through this service (service
   * callers are bucketed per office — see caller.ts). A safety net under
   * Dostoori's own per-office monthly quota, not the primary limit.
   */
  get costCapPerOfficeUsd() {
    return num("COST_CAP_PER_OFFICE_USD", 5);
  },

  // ---- provider deadlines ----
  /** Deadline for one non-streamed chat call (headers + body). */
  get chatTimeoutMs() {
    return num("LLM_TIMEOUT_MS", 45_000);
  },
  /** Max silence between streamed chunks before the stream is abandoned. */
  get streamIdleTimeoutMs() {
    return num("LLM_STREAM_IDLE_TIMEOUT_MS", 20_000);
  },
  /** Deadline for one embeddings call. */
  get embedTimeoutMs() {
    return num("EMBED_TIMEOUT_MS", 20_000);
  },

  /**
   * Whether sources marked is_synthetic (eval/test fixtures) may be retrieved.
   * Never set in production: a fixture must never be quoted to a lawyer as law.
   */
  get allowSyntheticCorpus() {
    return process.env.ALLOW_SYNTHETIC_CORPUS === "true";
  },

  get storageDir() {
    return process.env.STORAGE_DIR ?? "./storage";
  },

  get topK() {
    return num("RETRIEVAL_TOP_K", 8);
  },
  get minScore() {
    return num("RETRIEVAL_MIN_SCORE", 0.3);
  },

  /**
   * When the knowledge base has no source, answer from the model's general
   * knowledge instead of stopping at the refusal.
   *
   * The ungrounded answer is concept-level only: `ai/guard.ts` redacts every
   * article and decision number from it before it is sent, so it can orient a
   * lawyer but can never hand them a citation to rely on. It is labelled and
   * rendered as ungrounded in the UI, and recorded with grounded=false.
   *
   * (Historical default was ON; see the Phase 2 note below.)
   */
  get allowGeneralFallback() {
    // Phase 2: default OFF. An ungrounded "general knowledge" answer — even
    // fenced, disclaimed and citation-redacted — still states legal rules
    // (and, per its prompt, limitation periods) that nothing in the corpus
    // supports. The safe default for a law office is an explicit "no
    // sufficient evidence" answer; the fallback is an opt-in for the
    // standalone app only, and is never used for service (Dostoori) callers.
    return (process.env.ALLOW_GENERAL_FALLBACK ?? "false") === "true";
  },

  /**
   * Whether the query-understanding layer may fall back to a small LLM call
   * when its rule tier is not confident about a question's type. Default ON.
   * The fallback runs only for ambiguous questions — clear ones (an article
   * number, a drafting imperative, "ما الفرق بين…") never reach it, so this
   * does not add latency to simple queries. Set to false to stay rules-only.
   */
  get queryLlmFallback() {
    return (process.env.QUERY_LLM_FALLBACK ?? "true") !== "false";
  },

  /**
   * Legal query expansion: merge statutory synonyms into the search text before
   * retrieval, so a question phrased in everyday Arabic ("أخذ مبلغاً وقال إنه
   * قرض") still reaches the article that speaks of "مال مسلَّم على وجه الأمانة".
   * The curated ontology runs on every query for free; the LLM source is
   * limited to fact_pattern questions. Default ON — set false to search the
   * lawyer's wording verbatim.
   */
  get legalQueryExpansion() {
    return (process.env.LEGAL_QUERY_EXPANSION ?? "true") !== "false";
  },

  /**
   * Dynamic score-gap cutoff: trims the ranked list at the first big
   * proportional drop between adjacent candidates (see search/hybrid.ts's
   * applyScoreGapCutoff), on top of the existing per-queryType static floor
   * (search/confidence.ts). Default OFF — a prior dynamic-threshold change in
   * this codebase cost a case for zero measured recall gain (see memory), so
   * this one ships behind a flag until scripts/benchmark.ts says otherwise on
   * THIS corpus, not on the strength of the idea alone.
   */
  get dynamicScoreGap() {
    return (process.env.DYNAMIC_SCORE_GAP ?? "false") === "true";
  },

  /**
   * Type-2 "hybrid" supplement: when real sources were retrieved but overall
   * confidence came back "منخفضة" (see confidence.ts), additionally ask GPT
   * for supplementary legal reasoning alongside the grounded, cited answer.
   * Every citation-shaped span in that supplement is checked against the
   * database (citation-verify.ts) before it reaches the client. Default ON —
   * set false to keep low-confidence answers grounded-only, with no
   * supplement, as before.
   */
  get hybridFallback() {
    // Phase 2: default OFF, and never used for service (Dostoori) callers —
    // the supplement is model-memory legal reasoning shown next to a cited
    // answer. Opt in with GPT_HYBRID_FALLBACK=true for the standalone app.
    return (process.env.GPT_HYBRID_FALLBACK ?? "false") === "true";
  },

  /**
   * Gap-fill supplement: a general-knowledge paragraph for each [فجوة: …] a
   * grounded answer left open. Phase 2: default OFF (the gap is stated
   * plainly instead), never used for service callers. GAP_FILL_ENABLED=true
   * restores it for the standalone app.
   */
  get gapFillEnabled() {
    return (process.env.GAP_FILL_ENABLED ?? "false") === "true";
  },

  /**
   * Scope the exact-article arm to the law the question names, and answer
   * "that law is not in the database" when it names one the corpus lacks
   * (search/law-reference.ts). Default ON; LAW_SCOPED_EXACT=false restores
   * the unscoped behaviour for before/after measurement.
   */
  get lawScopedExact() {
    return (process.env.LAW_SCOPED_EXACT ?? "true") !== "false";
  },

  /**
   * Re-join an article the chunker split into several parts before it is
   * shown to the model (search/hybrid.ts mergeArticleParts), so a rule is
   * never read without the exception in its next part. Default ON;
   * MERGE_ARTICLE_PARTS=false for before/after measurement.
   */
  get mergeArticleParts() {
    return (process.env.MERGE_ARTICLE_PARTS ?? "true") !== "false";
  },

  /**
   * The embedding model that produced vectors stored before Phase 2 began
   * recording legal_documents.embedding_model. Untagged rows are treated as
   * this model; retrieval compares a query vector only with rows of the same
   * model. The production corpus was built with text-embedding-3-small
   * (deploy docs); change this only together with a full re-index.
   */
  get legacyEmbeddingModel() {
    return process.env.LEGACY_EMBEDDING_MODEL ?? "text-embedding-3-small";
  },

  /** Hard deadline for one whole AI request inside this service (all model calls + retrieval). */
  get requestDeadlineMs() {
    return num("AI_REQUEST_DEADLINE_MS", 90_000);
  },

  /** Days standalone-app content (chat_history, uploaded_cases, stored PDFs) is kept before the purge deletes it. */
  get retentionDays() {
    return num("CONTENT_RETENTION_DAYS", 90);
  },

  /**
   * Phase 6 post-generation self-verification (self-verify.ts): an LLM judge
   * reviews the grounded answer for coverage/grounding/hallucination/
   * contradiction, with one bounded repair regeneration and a safe
   * verbatim-source fallback if that repair still fails. Default ON — it was
   * explicitly requested — but unlike the retrieval-side flags above, this
   * one has no benchmark behind its calibration: confidence.ts's thresholds
   * and the reranker were tuned against scripts/benchmark.ts's 100-question
   * labeled set, but there is no equivalent labeled set for "was this judge
   * verdict actually correct". Measured live (scripts/tmp-verify-phase6.ts):
   * it flagged 2 of 3 real test questions and fell back to the safe verbatim
   * answer for both — possibly correct (genuinely incomplete relative to the
   * full question), possibly an overly strict judge trading polish for
   * caution more often than warranted. Set to false to disable entirely
   * (grounded answers ship exactly as they did before Phase 6) if the
   * fallback rate proves too high in production — same "ship behind a flag,
   * prove it out or dial back" reasoning as dynamicScoreGap above.
   */
  get selfVerification() {
    return (process.env.SELF_VERIFICATION ?? "true") !== "false";
  },
};
