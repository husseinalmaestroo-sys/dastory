import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes } from "@/lib/http";
import { admit, failureResponse, runAiRequest } from "@/lib/ai/request";
import { runDraft } from "@/lib/ai/pipelines/documents";
import { sourceAuthorityOf } from "@/lib/ai/pipelines/chat";
import { NO_EVIDENCE_ANSWER_AR } from "@/lib/ai/prompts";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["statement_of_claim", "reply", "defense_memo", "petition", "contract"]),
  fields: z.record(z.string().max(4000)),
  notes: z.string().max(2000).default(""),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[draft] unhandled error before response:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const body = await readBodyLimited(req, 256 * 1024);
  if (!body.ok) return body.response;

  const auth = await requireCaller(req, body.bytes);
  if (auth.response) return auth.response;
  const caller = auth.caller;

  const parsed = Body.safeParse(parseJsonBytes(body.bytes));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }

  const refused = await admit(caller, "draft");
  if (refused) return refused;

  const r = await runAiRequest(caller, "draft", req.signal, () => runDraft(parsed.data, caller));
  if (!r.ok) return failureResponse(r);
  const v = r.value;
  if ("missing" in v) return Response.json({ error: `حقول مطلوبة ناقصة: ${v.missing.join("، ")}` }, { status: 400 });
  if ("invalid" in v) {
    return Response.json({ error: "تعذّر الحصول على مسودة صالحة. حاول مرة أخرى.", requestId: r.usage.requestId }, { status: 502 });
  }
  if ("noEvidence" in v) {
    return Response.json({ draft: NO_EVIDENCE_ANSWER_AR, grounded: false, groundingLevel: "none", mode: "no_evidence", sources: [], usage: r.usage, provenance: r.provenance });
  }

  if (caller.retainContent) {
    const { sessionId } = await getSession();
    void recordUsage({
      sessionId,
      question: `[مسودة: ${parsed.data.kind}]`,
      answer: v.draft,
      sourcesUsed: v.sources.filter((s) => s.cited),
      grounded: v.groundingLevel !== "none",
      mode: v.groundingLevel,
      tokensIn: r.usage.tokensIn,
      tokensOut: r.usage.tokensOut,
      embeddingTokens: r.usage.embeddingTokens,
      latencyMs: 0,
      hitCount: v.sources.length,
      costUsd: r.usage.estimatedCostUsd,
    });
  }

  return Response.json({
    draft: v.draft,
    // `grounded` now means "carries at least one legal citation verified
    // against a retrieved source" — it used to be hard-coded true.
    grounded: v.groundingLevel !== "none",
    groundingLevel: v.groundingLevel,
    mode: "drafted",
    validation: v.validation,
    sources: v.sources,
    // Phase 2.1: whether the cited texts were verified against their official publication.
    sourceAuthority: sourceAuthorityOf(v.sources),
    usage: r.usage,
    provenance: r.provenance,
  });
}
