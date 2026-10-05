import "server-only";
import { env } from "../env";
import { isRetryableStatus, linkSignal } from "./deadline";
import { currentSignal } from "./usage-meter";
import type { EmbeddingProvider, EmbedResult } from "./provider";
import { proxiedFetch } from "../net/proxy";

/**
 * Voyage AI embeddings — Anthropic's recommended embedding partner, since
 * Anthropic publishes no embeddings endpoint of its own.
 *
 * Called over plain fetch rather than an SDK: it is one POST with a JSON body,
 * and a dependency would buy nothing.
 */

const API = "https://api.voyageai.com/v1/embeddings";

// Voyage's own per-request ceiling is 128 texts. Batching cuts round-trips by
// ~100x on a large law.
const BATCH_SIZE = 128;

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
};

/**
 * One batch with a deadline covering headers AND body (it had none — a stalled
 * connection held ingestion or a question forever), retried once on a
 * transient failure (429 / 5xx / network). Embeddings are idempotent; see
 * deadline.ts for the policy.
 */
async function postBatch(batch: string[], kind: "document" | "query"): Promise<VoyageResponse> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    linkSignal(ctrl, currentSignal());
    const timer = setTimeout(() => ctrl.abort(), env.embedTimeoutMs);
    let status: number | undefined;
    try {
      // Through the environment's HTTPS proxy when one is set (net/proxy.ts).
      const res = await proxiedFetch(API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.voyageApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.embeddingModel,
          input: batch,
          // Voyage embeds a question and a passage differently — asking for
          // "query" on a search and "document" on a chunk measurably improves
          // retrieval over treating both as the same kind of text.
          input_type: kind,
          output_dimension: env.embeddingDim,
        }),
        signal: ctrl.signal,
      });
      status = res.status;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Voyage embeddings failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
      }
      return (await res.json()) as VoyageResponse;
    } catch (err) {
      if (attempt >= 1 || !(status === undefined || isRetryableStatus(status))) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const voyageProvider: EmbeddingProvider = {
  name: "voyage",
  get model() {
    return env.embeddingModel;
  },
  get dimensions() {
    return env.embeddingDim;
  },

  async embed(texts: string[], kind: "document" | "query"): Promise<EmbedResult> {
    const embeddings: number[][] = [];
    let tokens = 0;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const json = await postBatch(texts.slice(i, i + BATCH_SIZE), kind);

      // The API returns an explicit index and does not guarantee response
      // order. Sort by it rather than trusting position, or chunk N gets chunk
      // M's vector and retrieval silently rots.
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      for (const d of sorted) embeddings.push(d.embedding);
      tokens += json.usage?.total_tokens ?? 0;
    }

    return { embeddings, tokens };
  },
};
