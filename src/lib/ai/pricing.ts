import "server-only";

/**
 * USD per 1M tokens. Used only for the dashboard's cost estimate — it is a
 * projection for our own budgeting, never a bill. Vendor prices move; when
 * they do, this table is the single place to correct.
 *
 * Keep every model any provider can be pointed at. A model missing here does
 * not error — it silently falls back and the dashboard quietly under-reports,
 * which is the worst way for a cost number to be wrong.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  // --- OpenAI chat ---
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },

  // --- OpenAI embeddings (output side is always 0) ---
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },

  // --- Anthropic chat ---
  // Note the gap vs gpt-4o-mini: ~33x on input, ~42x on output. On a public
  // app with no login that difference is the whole cost model, not a detail.
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },

  // --- Voyage embeddings ---
  "voyage-3-large": { in: 0.18, out: 0 },
  "voyage-3.5": { in: 0.06, out: 0 },
  "voyage-3.5-lite": { in: 0.02, out: 0 },

  // --- deterministic offline test providers (ai/test-provider.ts): free ---
  "test-extractive-v1": { in: 0, out: 0 },
  "test-hash-embed-v1": { in: 0, out: 0 },
};

const FALLBACK = { in: 0.15, out: 0.6 };

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICES[model] ?? FALLBACK;
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}

/** True when the model is priced here rather than guessed. Lets callers warn. */
export function isPriced(model: string): boolean {
  return model in PRICES;
}
