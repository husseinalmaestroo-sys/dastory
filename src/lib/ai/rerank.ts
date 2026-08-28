import "server-only";
import { env } from "../env";

/**
 * Cross-encoder reranking, behind one seam.
 *
 * WHY A RERANKER AT ALL
 *
 * RRF fuses two RANKINGS; it never reads the question and a passage together.
 * A bi-encoder embedding is computed for the query and the chunk separately, so
 * "هل القرض يعتبر إساءة ائتمان؟" and an article about الأمانة are compared as
 * two independent summaries of meaning. A cross-encoder scores the PAIR — it
 * sees both texts at once — which is exactly the judgement RRF cannot make.
 * That is why the design is retrieve-wide-then-rerank-narrow: 50 cheap
 * candidates, then 8 chosen by a model that actually read them.
 *
 * WHY IT IS OFF BY DEFAULT
 *
 * `RERANK_PROVIDER` defaults to "none", so this file changes nothing until it
 * is switched on deliberately. A reranker is a quality claim, and a quality
 * claim without a measurement is a guess — run scripts/benchmark-rerank.ts and
 * look at the numbers before enabling it in production.
 */

export type RerankHit = { index: number; score: number };

export interface RerankProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Scores each document against the query and returns them ordered best-first.
   * `index` refers back into the `documents` array the caller passed in.
   */
  rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]>;
}

// Documents are truncated before they are sent: rerankers charge by token and
// cap their input, and a legal chunk's relevance is decided by its opening far
// more often than by its tail.
const MAX_DOC_CHARS = 4000;
const TIMEOUT_MS = 8000;

async function postJson(url: string, key: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${detail.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cohere Rerank. `rerank-multilingual-v3.0` is the multilingual cross-encoder;
 * Arabic is in its training mix, which is the reason it is a candidate here.
 * Response shape: { results: [{ index, relevance_score }] }.
 */
class CohereReranker implements RerankProvider {
  readonly name = "cohere";
  constructor(readonly model: string) {}

  async rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]> {
    const json = (await postJson("https://api.cohere.com/v2/rerank", env.cohereApiKey, {
      model: this.model,
      query,
      documents: documents.map((d) => d.slice(0, MAX_DOC_CHARS)),
      top_n: Math.min(topN, documents.length),
    })) as { results?: { index: number; relevance_score: number }[] };

    if (!Array.isArray(json.results)) throw new Error("Cohere rerank: unexpected response shape");
    return json.results.map((r) => ({ index: r.index, score: r.relevance_score }));
  }
}

/**
 * Voyage Rerank. Same contract, different envelope:
 * { data: [{ index, relevance_score }] }. Kept as a sibling so the two can be
 * compared by flipping one env var rather than by editing retrieval code.
 */
class VoyageReranker implements RerankProvider {
  readonly name = "voyage";
  constructor(readonly model: string) {}

  async rerank(query: string, documents: string[], topN: number): Promise<RerankHit[]> {
    const json = (await postJson("https://api.voyageai.com/v1/rerank", env.voyageApiKey, {
      model: this.model,
      query,
      documents: documents.map((d) => d.slice(0, MAX_DOC_CHARS)),
      top_k: Math.min(topN, documents.length),
    })) as { data?: { index: number; relevance_score: number }[] };

    if (!Array.isArray(json.data)) throw new Error("Voyage rerank: unexpected response shape");
    return json.data.map((r) => ({ index: r.index, score: r.relevance_score }));
  }
}

const DEFAULT_MODEL: Record<string, string> = {
  cohere: "rerank-multilingual-v3.0",
  voyage: "rerank-2",
};

/**
 * The configured reranker, or null when reranking is off.
 *
 * Returns null rather than throwing for "none" so every call site can treat
 * reranking as optional and the pipeline degrades to plain RRF.
 */
export function getRerankProvider(overrides?: { provider?: string; model?: string }): RerankProvider | null {
  const name = (overrides?.provider ?? env.rerankProvider).toLowerCase();
  if (!name || name === "none" || name === "off") return null;

  const model = overrides?.model ?? env.rerankModel ?? DEFAULT_MODEL[name];
  if (!model) throw new Error(`RERANK_MODEL is not set and no default exists for provider "${name}".`);

  switch (name) {
    case "cohere":
      return new CohereReranker(model);
    case "voyage":
      return new VoyageReranker(model);
    default:
      throw new Error(`Unknown RERANK_PROVIDER "${name}". Use: cohere | voyage | none.`);
  }
}
