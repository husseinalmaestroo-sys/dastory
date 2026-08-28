"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, Citation } from "@/types";

export type Filters = { category?: string; court?: string; year?: number };

/**
 * Chat state over the SSE endpoint.
 *
 * Hand-rolled rather than EventSource because EventSource is GET-only and the
 * question needs a POST body.
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, update: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(
    async (question: string, filters: Filters = {}) => {
      if (busy || !question.trim()) return;

      const userId = crypto.randomUUID();
      const botId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: question },
        { id: botId, role: "assistant", content: "", pending: true },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, filters }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          patch(botId, { pending: false, error: err.error ?? "تعذّر الاتصال بالخادم." });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. A chunk can split one in
          // half, so only consume whole frames and keep the remainder buffered.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const evMatch = frame.match(/^event: (.+)$/m);
            const dataMatch = frame.match(/^data: (.+)$/m);
            if (!evMatch || !dataMatch) continue;

            const event = evMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === "sources") {
              patch(botId, { sources: data as Citation[] });
            } else if (event === "delta") {
              text += data.text;
              patch(botId, { content: text, pending: false });
            } else if (event === "gapfill") {
              patch(botId, { gapFill: data.text, gapFillRedactedCount: data.redactedCount });
            } else if (event === "hybrid") {
              patch(botId, { hybridAnalysis: data.text, hybridAnalysisVerifiedCount: data.verifiedCount, hybridAnalysisRedactedCount: data.redactedCount });
            } else if (event === "done") {
              // The server sends `content` only when it swept a gap clause out
              // of what already streamed — overwrite the accumulated text with
              // its cleaned version so that clause doesn't linger on screen.
              // `patch` spreads its update object as-is, so the key must be
              // omitted entirely rather than set to `undefined`, or it would
              // blank out the content that already streamed in.
              const contentOverride = typeof data.content === "string" ? { content: data.content } : {};
              patch(botId, {
                ...contentOverride,
                pending: false,
                grounded: data.grounded,
                mode: data.mode,
                disclaimer: data.disclaimer,
                redactedCount: data.redactedCount,
                sources: data.sources,
                confidence: data.confidence ?? undefined,
                gapFill: data.gapFill ?? undefined,
                gapFillRedactedCount: data.gapFillRedactedCount,
                hybridAnalysis: data.hybridAnalysis ?? undefined,
                hybridAnalysisVerifiedCount: data.hybridAnalysisVerifiedCount,
                hybridAnalysisRedactedCount: data.hybridAnalysisRedactedCount,
              });
            } else if (event === "error") {
              patch(botId, { pending: false, error: data.message });
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patch(botId, { pending: false, error: "انقطع الاتصال. حاول مرة أخرى." });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, patch]
  );

  const reset = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  return { messages, busy, send, stop, reset, setMessages };
}
