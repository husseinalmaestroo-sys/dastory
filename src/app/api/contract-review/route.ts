import { NextRequest } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes } from "@/lib/http";
import { admit, failureResponse, runAiRequest } from "@/lib/ai/request";
import { runContractReview, MAX_CONTRACT_FULL_REVIEW_CHARS } from "@/lib/ai/pipelines/documents";
import { sourceAuthorityOf } from "@/lib/ai/pipelines/chat";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_CONTRACT_CHARS = 200_000;

const Body = z.object({
  // Text, not a file: the caller (Dostoori) already extracted it with its own
  // pipeline (OCR fallback included).
  contractText: z.string().min(20, "نص العقد قصير جداً").max(MAX_CONTRACT_CHARS),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[contract-review] unhandled error before response:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const body = await readBodyLimited(req, MAX_CONTRACT_CHARS * 4 + 1024);
  if (!body.ok) return body.response;

  const auth = await requireCaller(req, body.bytes);
  if (auth.response) return auth.response;
  const caller = auth.caller;

  const parsed = Body.safeParse(parseJsonBytes(body.bytes));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }

  const refused = await admit(caller, "contract_review");
  if (refused) return refused;

  const r = await runAiRequest(caller, "contract_review", req.signal, () => runContractReview(parsed.data.contractText, caller));
  if (!r.ok) return failureResponse(r);
  const v = r.value;
  if ("invalid" in v) {
    return Response.json({ error: "تعذّر الحصول على مراجعة صالحة لهذا العقد. حاول مرة أخرى.", requestId: r.usage.requestId }, { status: 502 });
  }
  // Nothing about the contract is stored here, for any caller.
  return Response.json({
    ...v.review,
    // Kept for older clients: true whenever ANY part was not analysed.
    truncated: v.coverage.partial,
    coverage: v.coverage,
    maxFullReviewChars: MAX_CONTRACT_FULL_REVIEW_CHARS,
    validation: v.validation,
    sources: v.sources,
    sourceAuthority: sourceAuthorityOf(v.sources),
    usage: r.usage,
    provenance: r.provenance,
  });
}
