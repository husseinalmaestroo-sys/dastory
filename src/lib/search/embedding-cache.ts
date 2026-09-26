import "server-only";
import { createHash } from "node:crypto";

/**
 * In-memory cache for query embeddings, keyed by the exact text that was
 * embedded (post-expansion `searchText`, never the raw question — expansion
 * can change what actually gets embedded, and this cache must key on the
 * literal model input, not something that merely correlates with it).
 *
 * Measured in scripts/tmp-timing-stages.ts: the embedding call is roughly a
 * third to a half of hybridSearch's own warm latency (~200ms of it), and a
 * legal-research corpus sees the same well-known questions repeatedly across
 * sessions — a cache hit skips that OpenAI round-trip entirely. A miss is
 * indistinguishable from today's behaviour, so this can only help, never
 * regress correctness: the embedding for a fixed model + fixed text does not
 * change between calls, unlike a full search-result cache (not done here),
 * which would also have to answer "does this go stale when the corpus
 * changes" — a fixed text→vector mapping never needs invalidating.
 *
 * Same "unbounded Maps are how long-lived Node processes die" concern as
 * ratelimit.ts — bounded size, evict least-recently-used on overflow (a plain
 * Map's iteration order is insertion order, and re-inserting on read moves an
 * entry to the end, so the first key is always the least recently used one).
 */
const MAX_ENTRIES = 500;
const cache = new Map<string, number[]>();

/**
 * Phase 2: the key is a SHA-256 of (model, text), not the text itself.
 *   • model — a vector is only valid for the model that produced it; after an
 *     EMBEDDING_MODEL change a text-keyed cache would hand the new model's
 *     query a stale old-model vector for every cached question.
 *   • hashed — the searched text can be a slice of a confidential contract or
 *     case file (contract/case retrieval queries are built from the document).
 *     Keeping the plaintext as a long-lived Map key retained client content in
 *     process memory with no owner; a digest keeps the cache's function and
 *     drops the content. Values are vectors only, never text, so the cache
 *     cannot hand one caller another caller's words.
 */
function keyOf(searchText: string, model: string): string {
  return createHash("sha256").update(model).update("\u0000").update(searchText).digest("base64url");
}

export function getCachedEmbedding(searchText: string, model = ""): number[] | null {
  const key = keyOf(searchText, model);
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function setCachedEmbedding(searchText: string, embedding: number[], model = ""): void {
  const key = keyOf(searchText, model);
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, embedding);
}

/** Test/eval hook: forget everything (e.g. between evaluation runs with different models). */
export function clearEmbeddingCache(): void {
  cache.clear();
}
