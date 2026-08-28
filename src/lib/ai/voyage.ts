import "server-only";
import { env } from "../env";
import type { EmbeddingProvider, EmbedResult } from "./provider";

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
      const batch = texts.slice(i, i + BATCH_SIZE);

      const res = await fetch(API, {
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
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Voyage embeddings failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
      }

      const json = (await res.json()) as VoyageResponse;

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
