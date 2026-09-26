import { NextRequest } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes } from "@/lib/http";
import { admit, failureResponse, runAiRequest } from "@/lib/ai/request";
import { runRefine } from "@/lib/ai/pipelines/documents";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["statement_of_claim", "reply", "defense_memo", "petition", "contract"]),
  action: z.enum(["regenerate", "improve", "shorten", "expand"]),
  sectionHeading: z.string().max(200).default(""),
  blockText: z.string().min(1).max(6000),
  fullDraft: z.string().min(1).max(20000),
  // DB ids from the SAME draft's `sources` list (public corpus chunks) —
  // never a fresh search. z.coerce: `pg` returns BIGSERIAL ids as strings.
  sourceIds: z.array(z.coerce.number().int().positive()).max(20).default([]),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[draft/refine] unhandled error before response:", err);
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

  const refused = await admit(caller, "draft_refine");
  if (refused) return refused;

  const r = await runAiRequest(caller, "draft_refine", req.signal, () => runRefine(parsed.data, caller));
  if (!r.ok) return failureResponse(r);
  const v = r.value;
  if ("invalid" in v) {
    return Response.json({ error: "تعذّر الحصول على صياغة صالحة. حاول مرة أخرى.", requestId: r.usage.requestId }, { status: 502 });
  }
  return Response.json({ text: v.text, strippedCount: v.strippedCount, redactedCount: v.redactedCount, usage: r.usage, provenance: r.provenance });
}
