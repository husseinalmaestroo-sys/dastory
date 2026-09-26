import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { linkSignal, withDeadline, withIdleTimeout } from "./deadline";
import type { ChatProvider, ChatMessage, ChatResult } from "./provider";

// Lazy for the same reason the DB pool is: `next build` imports this module,
// and the constructor would demand ANTHROPIC_API_KEY on any machine that
// builds without a populated .env.
//
// maxRetries: 0 + explicit per-call deadlines — the SDK default retried a
// failed generation twice with a 10-minute timeout, multiplying cost without
// it ever appearing in usage. See deadline.ts for the retry policy.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 0, timeout: env.chatTimeoutMs });
  return _client;
}

/**
 * Anthropic's Messages API takes the system prompt as a top-level parameter,
 * not as a `system`-role message the way OpenAI does. Split it out here so the
 * rest of the app can keep using one message-list shape for both vendors.
 */
function split(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return { system, turns };
}

export const anthropicProvider: ChatProvider = {
  name: "anthropic",
  get model() {
    return env.anthropicModel;
  },

  async chat(messages, opts = {}): Promise<ChatResult> {
    const { system, turns } = split(messages);
    const model = opts.model ?? env.anthropicModel;
    const ctrl = new AbortController();
    linkSignal(ctrl, opts.signal);

    const res = await withDeadline(
      "anthropic message",
      opts.timeoutMs ?? env.chatTimeoutMs,
      ctrl,
      client().messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 4096,
          system,
          messages: turns,
          // Adaptive thinking: the model decides how much to reason per request.
          // Worth it here — deciding whether the retrieved sources actually
          // support an answer, or whether to refuse, is the judgment this whole
          // system rests on.
          thinking: { type: "adaptive" },
          // Note: temperature/top_p are not accepted on current Claude models and
          // return a 400. Behaviour is steered by the prompt, which is where the
          // closed-domain rules already live.
        },
        { signal: ctrl.signal }
      )
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      text,
      tokensIn: res.usage.input_tokens,
      tokensOut: res.usage.output_tokens,
      model,
    };
  },

  async *chatStream(messages, opts = {}) {
    const { system, turns } = split(messages);
    const model = opts.model ?? env.anthropicModel;
    const ctrl = new AbortController();
    linkSignal(ctrl, opts.signal);

    const stream = client().messages.stream(
      {
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system,
        messages: turns,
        thinking: { type: "adaptive" },
      },
      { signal: ctrl.signal }
    );

    let text = "";
    // A stream that goes silent (or never ends) is abandoned: idle gap and
    // total duration are both bounded.
    for await (const event of withIdleTimeout(stream, {
      idleMs: env.streamIdleTimeoutMs,
      totalMs: env.chatTimeoutMs * 3,
      what: "anthropic stream",
      abort: () => ctrl.abort(),
    })) {
      // Only text deltas reach the user. Thinking blocks stream too (with
      // empty text by default) — forwarding them would emit blanks into the
      // answer.
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        yield event.delta.text;
      }
    }

    const final = await withDeadline("anthropic final message", env.streamIdleTimeoutMs, ctrl, stream.finalMessage());
    return {
      text,
      tokensIn: final.usage.input_tokens,
      tokensOut: final.usage.output_tokens,
      model,
    };
  },
};
