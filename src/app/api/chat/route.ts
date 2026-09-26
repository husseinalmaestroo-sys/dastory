import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession } from "@/lib/session";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes, wantsJson } from "@/lib/http";
import { admit, failureResponse, runAiRequest } from "@/lib/ai/request";
import { runChatPipeline, type ChatOutcome } from "@/lib/ai/pipelines/chat";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;

const Body = z.object({
  question: z.string().min(3, "السؤال قصير جداً").max(2000, "السؤال طويل جداً"),
  filters: z
    .object({
      category: z.string().max(100).optional(),
      court: z.string().max(100).optional(),
      year: z.number().int().optional(),
      sourceType: z.string().max(40).optional(),
    })
    .optional(),
  // Prior turns, used ONLY to rewrite a follow-up into a standalone question
  // (the answer prompt never sees them). Only user/assistant roles exist: a
  // "system" turn is rejected outright, never interpreted.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .max(12)
    .optional(),
});

/** Everything a client may see of the outcome (internal accounting stays out). */
function publicOutcome(o: ChatOutcome) {
  const { outcome: _internal, ...rest } = o;
  return rest;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[chat] unhandled error before response start:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const body = await readBodyLimited(req, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const auth = await requireCaller(req, body.bytes);
  if (auth.response) return auth.response;
  const caller = auth.caller;

  const parsed = Body.safeParse(parseJsonBytes(body.bytes));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }

  const refused = await admit(caller, "chat");
  if (refused) return refused;

  // Dostoori (and any JSON client): one validated JSON response.
  if (caller.kind === "service" || wantsJson(req)) {
    const r = await runAiRequest(caller, "chat", req.signal, () => runChatPipeline(parsed.data, caller));
    if (!r.ok) return failureResponse(r);
    return Response.json({ ...publicOutcome(r.value), usage: r.usage, provenance: r.provenance });
  }

  // Standalone UI: SSE. Sources are sent as soon as retrieval finishes; the
  // answer is sent once, AFTER grounding — never unverified tokens.
  const { sessionId } = await getSession();
  void touchSession(sessionId);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const started = Date.now();
      const r = await runAiRequest(caller, "chat", req.signal, () => runChatPipeline(parsed.data, caller, send));
      if (!r.ok) {
        send("error", { message: r.error === "timeout" ? "انتهت مهلة معالجة السؤال. حاول مرة أخرى." : "تعذّر توليد الإجابة. حاول مرة أخرى." });
      } else {
        const o = r.value;
        send("delta", { text: o.answer });
        if (o.gapFill) send("gapfill", { text: o.gapFill, redactedCount: 0 });
        if (o.hybridAnalysis) send("hybrid", { text: o.hybridAnalysis, verifiedCount: 0, redactedCount: 0 });
        send("done", { ...publicOutcome(o), content: o.answer, usage: r.usage, provenance: r.provenance });
        if (caller.retainContent) {
          void recordUsage({
            sessionId,
            question: parsed.data.question,
            answer: o.answer,
            sourcesUsed: o.sources.filter((s) => s.cited),
            grounded: o.grounded,
            mode: o.mode,
            tokensIn: r.usage.tokensIn,
            tokensOut: r.usage.tokensOut,
            embeddingTokens: r.usage.embeddingTokens,
            latencyMs: Date.now() - started,
            category: parsed.data.filters?.category ?? null,
            hitCount: o.outcome.retrievalCount ?? 0,
            costUsd: r.usage.estimatedCostUsd,
            verification: o.verification
              ? { issues: o.verification.issues, severity: o.verification.severity, action: o.verification.status, repaired: o.verification.repaired }
              : null,
          });
        }
      }
      closed = true;
      ctrl.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which would hold the
      // whole SSE stream until the request ends.
      "X-Accel-Buffering": "no",
    },
  });
}
