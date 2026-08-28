import "server-only";
import OpenAI from "openai";
import { env } from "../env";
import type { ChatProvider, EmbeddingProvider, ChatMessage, ChatResult, EmbedResult } from "./provider";

// Lazy for the same reason the DB pool is: `next build` imports this module,
// and the constructor would demand OPENAI_API_KEY on any machine that builds
// without a populated .env.
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: env.openaiApiKey });
  return _client;
}

// Embedding calls are the bulk of ingest cost. Batching cuts round-trips by
// ~100x on a large law; the cap keeps any single request under the API's
// per-request token ceiling.
const EMBED_BATCH_SIZE = 96;

export const openaiEmbeddingProvider: EmbeddingProvider = {
  name: "openai",
  get model() {
    return env.embeddingModel;
  },
  get dimensions() {
    return env.embeddingDim;
  },

  // `kind` is ignored: OpenAI's embedding models have no query/document
  // distinction, unlike Voyage. Accepted so the interface stays uniform.
  async embed(texts: string[]): Promise<EmbedResult> {
    const embeddings: number[][] = [];
    let tokens = 0;

    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const res = await client().embeddings.create({
        model: env.embeddingModel,
        input: batch,
      });
      // The API does not guarantee response order matches input order; it
      // returns an explicit index. Sort by it rather than trusting position,
      // or chunk N gets chunk M's vector and retrieval silently rots.
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      for (const d of sorted) embeddings.push(d.embedding);
      tokens += res.usage?.total_tokens ?? 0;
    }

    return { embeddings, tokens };
  },
};

export const openaiChatProvider: ChatProvider = {
  name: "openai",
  get model() {
    return env.chatModel;
  },

  async chat(messages: ChatMessage[], opts = {}): Promise<ChatResult> {
    const res = await client().chat.completions.create({
      model: opts.model ?? env.chatModel,
      messages,
      // Low: this system quotes statutes. Creative phrasing here is a bug,
      // not a feature.
      temperature: 0.1,
      max_tokens: opts.maxTokens ?? 1500,
    });

    return {
      text: res.choices[0]?.message?.content ?? "",
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
    };
  },

  async *chatStream(messages: ChatMessage[], opts = {}) {
    const stream = await client().chat.completions.create({
      model: env.chatModel,
      messages,
      temperature: 0.1,
      max_tokens: opts.maxTokens ?? 1500,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let tokensIn = 0;
    let tokensOut = 0;

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield delta;
      }
      // Usage arrives on the final chunk only, once stream_options asks for it.
      if (part.usage) {
        tokensIn = part.usage.prompt_tokens ?? 0;
        tokensOut = part.usage.completion_tokens ?? 0;
      }
    }

    return { text, tokensIn, tokensOut };
  },
};
