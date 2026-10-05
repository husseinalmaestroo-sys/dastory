import "server-only";
import OpenAI from "openai";
import { env } from "../env";
import { proxyAgentFor } from "../net/proxy";
import { isRetryableStatus, linkSignal, withDeadline, withIdleTimeout } from "./deadline";
import { currentSignal } from "./usage-meter";
import type { ChatProvider, EmbeddingProvider, ChatMessage, ChatResult, EmbedResult } from "./provider";

// maxRetries: 0 — the SDK's default (2 retries, 10-minute timeout) silently
// multiplied the cost of a failed generation and could hold a request for
// half an hour. Every call below carries its own deadline instead; see
// deadline.ts for the retry policy.
let _client: OpenAI | null = null;
function client(): OpenAI {
  // Phase 2.4: through the environment's HTTPS proxy when one is set — the SDK
  // would otherwise connect directly, around the egress policy (net/proxy.ts).
  const host = new URL(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").hostname;
  if (!_client) _client = new OpenAI({ apiKey: env.openaiApiKey, maxRetries: 0, timeout: env.chatTimeoutMs, httpAgent: proxyAgentFor(host) });
  return _client;
}

// OpenAI's embeddings endpoint accepts up to 2048 inputs per call, but
// batching keeps one failed request from losing a whole large document.
const EMBED_BATCH_SIZE = 96;

async function embedBatch(batch: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    linkSignal(ctrl, currentSignal());
    try {
      const res = await withDeadline(
        "embeddings",
        env.embedTimeoutMs,
        ctrl,
        client().embeddings.create({ model: env.embeddingModel, input: batch }, { signal: ctrl.signal, timeout: env.embedTimeoutMs })
      );
      // Order by `index`, not arrival: the embedding for input[i] must land on chunk[i].
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      return { vectors: sorted.map((d) => d.embedding), tokens: res.usage?.total_tokens ?? 0 };
    } catch (err) {
      // One retry for an idempotent call on a transient failure (429, 5xx,
      // network/timeout — no status). Anything else is final.
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || isRetryableStatus(status);
      if (attempt >= 1 || !retryable) throw err;
    }
  }
}

export const openaiEmbeddingProvider: EmbeddingProvider = {
  name: "openai",
  get model() {
    return env.embeddingModel;
  },
  get dimensions() {
    return env.embeddingDim;
  },

  async embed(texts: string[]): Promise<EmbedResult> {
    const embeddings: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const { vectors, tokens: t } = await embedBatch(texts.slice(i, i + EMBED_BATCH_SIZE));
      embeddings.push(...vectors);
      tokens += t;
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
    const ctrl = new AbortController();
    linkSignal(ctrl, opts.signal);
    const model = opts.model ?? env.chatModel;
    const res = await withDeadline(
      "chat completion",
      opts.timeoutMs ?? env.chatTimeoutMs,
      ctrl,
      client().chat.completions.create(
        { model, messages, temperature: 0.1, max_tokens: opts.maxTokens ?? 1500 },
        { signal: ctrl.signal }
      )
    );

    return {
      text: res.choices[0]?.message?.content ?? "",
      tokensIn: res.usage?.prompt_tokens ?? 0,
      tokensOut: res.usage?.completion_tokens ?? 0,
      model,
    };
  },

  async *chatStream(messages: ChatMessage[], opts = {}) {
    const ctrl = new AbortController();
    linkSignal(ctrl, opts.signal);
    const model = opts.model ?? env.chatModel;
    const stream = await withDeadline(
      "chat stream start",
      opts.timeoutMs ?? env.chatTimeoutMs,
      ctrl,
      client().chat.completions.create(
        {
          model,
          messages,
          temperature: 0.1,
          max_tokens: opts.maxTokens ?? 1500,
          stream: true,
          // Without this the stream never reports token usage and every
          // streamed answer would be recorded as free.
          stream_options: { include_usage: true },
        },
        { signal: ctrl.signal }
      )
    );

    let text = "";
    let tokensIn = 0;
    let tokensOut = 0;

    // A stream that goes silent (or never ends) is abandoned: idle gap and
    // total duration are both bounded.
    for await (const part of withIdleTimeout(stream, {
      idleMs: env.streamIdleTimeoutMs,
      totalMs: env.chatTimeoutMs * 3,
      what: "chat stream",
      abort: () => ctrl.abort(),
    })) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield delta;
      }
      if (part.usage) {
        tokensIn = part.usage.prompt_tokens ?? 0;
        tokensOut = part.usage.completion_tokens ?? 0;
      }
    }

    return { text, tokensIn, tokensOut, model };
  },
};
