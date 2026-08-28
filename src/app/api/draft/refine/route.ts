import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession, hashIp } from "@/lib/session";
import { requireLawyer } from "@/lib/lawyer-auth";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { costToday, siteWideCostToday } from "@/lib/costcap";
import { env } from "@/lib/env";
import { getChunksByIds } from "@/lib/search/hybrid";
import { getChatProvider } from "@/lib/ai";
import { buildRefineSectionPrompt, type RefineAction } from "@/lib/ai/prompts";
import type { DraftKind } from "@/lib/drafting/forms";
import { stripInvalidCitations } from "@/lib/ai/guard";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["statement_of_claim", "reply", "defense_memo", "petition", "contract"]),
  action: z.enum(["regenerate", "improve", "shorten", "expand"]),
  sectionHeading: z.string().max(200).default(""),
  blockText: z.string().min(1).max(6000),
  fullDraft: z.string().min(1).max(20000),
  // The DB ids from the SAME draft's already-returned `sources` list — never
  // a fresh search. See hybrid.ts's getChunksByIds for why a [n] here must
  // resolve to the same source as the rest of the document's [n].
  //
  // z.coerce, not z.number: RetrievedChunk.id is typed `number`, but `pg`
  // returns BIGSERIAL columns as strings (BIGINT can't always fit a JS
  // number without losing precision) — route.ts's /api/draft response
  // already ships `id` as a JSON string for this exact reason, unnoticed
  // until this endpoint became the first thing to Zod-validate it strictly.
  sourceIds: z.array(z.coerce.number().int().positive()).max(20).default([]),
});

// Same thin-wrapper pattern as draft/route.ts and chat/route.ts: anything
// thrown before a response is returned (a dropped DB connection during
// requireLawyer/getChunksByIds chief among them) becomes the app's own
// Arabic error response instead of Next.js's default error page.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[draft/refine] unhandled error before response:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const started = Date.now();

  const { response: authError, lawyer } = await requireLawyer();
  if (authError) return authError;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }
  const { kind, action, sectionHeading, blockText, fullDraft, sourceIds } = parsed.data;

  const { sessionId } = await getSession();
  const rl = await rateLimit(`draft-refine:lawyer:${lawyer!.id}`, LIMITS.refine.limit, LIMITS.refine.windowSec);
  if (!rl.ok) {
    return Response.json({ error: "تجاوزت حد طلبات تعديل المقاطع. حاول لاحقاً." }, { status: 429 });
  }

  // Per-IP daily ceiling + cost circuit breakers — same reasoning as
  // draft/route.ts's identical block: a session cookie or a fresh lawyer
  // registration is nearly free to mint, IP hash is what survives both.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const rlDailyIp = await rateLimit(
    `draft-refine-daily-ip:${ipKey}`,
    LIMITS.refineDailyIp.limit,
    LIMITS.refineDailyIp.windowSec
  );
  if (!rlDailyIp.ok) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح به لطلبات التعديل. حاول غداً." }, { status: 429 });
  }
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return Response.json({ error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي للموقع. حاول لاحقاً." }, { status: 503 });
  }
  if ((await costToday(ipKey)) >= env.costCapPerUserUsd) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح للإنفاق من هذا الاتصال. حاول غداً." }, { status: 429 });
  }

  await touchSession(sessionId);

  const chunks = await getChunksByIds(sourceIds);

  const { system, user } = buildRefineSectionPrompt(
    kind as DraftKind,
    action as RefineAction,
    sectionHeading,
    blockText,
    fullDraft,
    chunks
  );
  const provider = getChatProvider();
  const result = await provider.chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // One section, not a whole document — a fraction of draft/route.ts's
    // 4000-token ceiling for the same reason it doesn't need more.
    { maxTokens: 1500 }
  );

  // Same guard draft/route.ts itself uses on the full document — not the
  // chat route's stricter verifyAndCleanCitations, which would make a
  // refined section pickier about citations than the rest of the document
  // it's patching, a consistency gap worse than the risk it would close.
  const { text, strippedCount } = stripInvalidCitations(result.text, chunks.length);
  if (strippedCount > 0) {
    console.warn(
      `[draft/refine] stripped ${strippedCount} out-of-range citation ref(s) — only ${chunks.length} source(s) available`
    );
  }

  void recordUsage({
    sessionId,
    costKey: ipKey,
    question: `[تعديل قسم: ${action}] ${sectionHeading || kind}`,
    answer: text,
    sourcesUsed: [],
    grounded: true,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    embeddingTokens: 0,
    latencyMs: Date.now() - started,
    hitCount: chunks.length,
  });

  return Response.json({ text, strippedCount });
}
