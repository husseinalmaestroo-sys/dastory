import "server-only";

/**
 * Two seams, not one.
 *
 * The first cut of this file had a single `AIProvider` with both `chat()` and
 * `embed()`, which quietly assumed one vendor does both. Anthropic does not
 * publish an embeddings endpoint at all — Claude is chat-only — so that
 * assumption made "use Claude" unrepresentable. Splitting the contracts lets
 * the two halves be chosen independently: Claude for answers, Voyage or OpenAI
 * for vectors.
 *
 * Everything upstream (retrieval, chat, ingest) talks only to these
 * interfaces, so a new vendor is one new file plus an env var.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};

export type EmbedResult = {
  embeddings: number[][];
  tokens: number;
};

export interface ChatProvider {
  readonly name: string;
  readonly model: string;

  /**
   * `opts.model` overrides the provider's own configured model for this ONE
   * call — falls back to `this.model` when omitted. Exists for callers like
   * self-verify.ts's judge, which does not need (and should not pay for)
   * whatever model the operator configured for the answer a lawyer actually
   * reads; a compact JSON classification is a different job with a different
   * cost/quality bar. Only on `chat()`, not `chatStream()` — nothing that
   * streams the visible answer needs a second model to switch to.
   */
  chat(messages: ChatMessage[], opts?: { maxTokens?: number; model?: string }): Promise<ChatResult>;
  chatStream(
    messages: ChatMessage[],
    opts?: { maxTokens?: number }
  ): AsyncGenerator<string, ChatResult, void>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Vector width. The `embedding` column's width is fixed at DDL time, so
   * changing provider or model means re-running the migration and re-indexing
   * the whole corpus — not a config flip.
   */
  readonly dimensions: number;

  embed(texts: string[], kind: "document" | "query"): Promise<EmbedResult>;
}
