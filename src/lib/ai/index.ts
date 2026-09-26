import "server-only";
import { env } from "../env";
import type { ChatProvider, EmbeddingProvider, ChatResult } from "./provider";
import { openaiChatProvider, openaiEmbeddingProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { voyageProvider } from "./voyage";
import { testChatProvider, testEmbeddingProvider, testProvidersAllowed } from "./test-provider";
import { currentMeter, currentSignal } from "./usage-meter";

/**
 * Chat and embeddings are chosen independently.
 *
 * They have to be: Anthropic publishes no embeddings endpoint, so "use Claude"
 * necessarily means Claude for answers plus someone else for vectors. The two
 * registries make that combination expressible instead of impossible.
 *
 * Every provider handed out here is METERED (usage-meter.ts): each call is
 * recorded, with the model that served it, into the meter of the request it
 * runs in — so no pipeline stage can spend tokens that never reach usage.
 */

const chatProviders: Record<string, ChatProvider> = {
  openai: openaiChatProvider,
  anthropic: anthropicProvider,
};

const embeddingProviders: Record<string, EmbeddingProvider> = {
  openai: openaiEmbeddingProvider,
  voyage: voyageProvider,
};

// Deterministic offline providers (test-provider.ts) — for CI and the offline
// evaluation harness. Refused in production unless explicitly allowed.
if (testProvidersAllowed()) {
  chatProviders.test = testChatProvider;
  embeddingProviders.test = testEmbeddingProvider;
}

function meteredChat(p: ChatProvider): ChatProvider {
  return {
    name: p.name,
    get model() {
      return p.model;
    },
    async chat(messages, callerOpts = {}) {
      const meter = currentMeter();
      const opts = { ...callerOpts, signal: callerOpts.signal ?? currentSignal() };
      const started = Date.now();
      const purpose = opts.purpose ?? "unlabelled";
      try {
        const r = await p.chat(messages, opts);
        meter?.add({ kind: "chat", purpose, model: r.model ?? opts.model ?? p.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, ms: Date.now() - started, ok: true });
        return r;
      } catch (err) {
        meter?.add({ kind: "chat", purpose, model: opts.model ?? p.model, tokensIn: 0, tokensOut: 0, ms: Date.now() - started, ok: false });
        throw err;
      }
    },
    async *chatStream(messages, callerOpts = {}) {
      const meter = currentMeter();
      const opts = { ...callerOpts, signal: callerOpts.signal ?? currentSignal() };
      const started = Date.now();
      let result: ChatResult | undefined;
      try {
        const gen = p.chatStream(messages, opts);
        let next = await gen.next();
        while (!next.done) {
          yield next.value;
          next = await gen.next();
        }
        result = next.value;
        return result;
      } finally {
        meter?.add({
          kind: "stream",
          purpose: opts.purpose ?? "unlabelled",
          model: result?.model ?? opts.model ?? p.model,
          tokensIn: result?.tokensIn ?? 0,
          tokensOut: result?.tokensOut ?? 0,
          ms: Date.now() - started,
          ok: result !== undefined,
        });
      }
    },
  };
}

function meteredEmbedding(p: EmbeddingProvider): EmbeddingProvider {
  return {
    name: p.name,
    get model() {
      return p.model;
    },
    get dimensions() {
      return p.dimensions;
    },
    async embed(texts, kind) {
      const meter = currentMeter();
      const started = Date.now();
      const purpose = kind === "query" ? "retrieval" : "ingest";
      try {
        const r = await p.embed(texts, kind);
        meter?.add({ kind: "embed", purpose, model: p.model, tokensIn: r.tokens, tokensOut: 0, ms: Date.now() - started, ok: true });
        return r;
      } catch (err) {
        meter?.add({ kind: "embed", purpose, model: p.model, tokensIn: 0, tokensOut: 0, ms: Date.now() - started, ok: false });
        throw err;
      }
    },
  };
}

const meteredChatCache = new Map<ChatProvider, ChatProvider>();
const meteredEmbedCache = new Map<EmbeddingProvider, EmbeddingProvider>();

export function getChatProvider(): ChatProvider {
  const p = chatProviders[env.chatProvider];
  if (!p) {
    throw new Error(
      `Unknown CHAT_PROVIDER "${env.chatProvider}". Registered: ${Object.keys(chatProviders).join(", ")}`
    );
  }
  let m = meteredChatCache.get(p);
  if (!m) meteredChatCache.set(p, (m = meteredChat(p)));
  return m;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const p = embeddingProviders[env.embeddingProvider];
  if (!p) {
    throw new Error(
      `Unknown EMBEDDING_PROVIDER "${env.embeddingProvider}". ` +
        `Registered: ${Object.keys(embeddingProviders).join(", ")}. ` +
        `Note: anthropic is not an option — Claude has no embeddings endpoint.`
    );
  }
  let m = meteredEmbedCache.get(p);
  if (!m) meteredEmbedCache.set(p, (m = meteredEmbedding(p)));
  return m;
}

export type {
  ChatProvider,
  EmbeddingProvider,
  ChatMessage,
  ChatResult,
  EmbedResult,
  ChatOptions,
} from "./provider";
