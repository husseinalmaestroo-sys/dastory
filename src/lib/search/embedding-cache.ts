import "server-only";

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

export function getCachedEmbedding(searchText: string): number[] | null {
  const hit = cache.get(searchText);
  if (!hit) return null;
  cache.delete(searchText);
  cache.set(searchText, hit);
  return hit;
}

export function setCachedEmbedding(searchText: string, embedding: number[]): void {
  if (!cache.has(searchText) && cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(searchText, embedding);
}
