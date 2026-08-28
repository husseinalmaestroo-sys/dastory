import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession, hashIp } from "@/lib/session";
import { requireLawyer } from "@/lib/lawyer-auth";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { costToday, siteWideCostToday } from "@/lib/costcap";
import { env } from "@/lib/env";
import { hybridSearch } from "@/lib/search/hybrid";
import { getChatProvider } from "@/lib/ai";
import { buildDraftPrompt, NO_BASIS_ANSWER } from "@/lib/ai/prompts";
import { fieldsOf, formatFields, hasSubstantialNotes, type DraftKind } from "@/lib/drafting/forms";
import { stripInvalidCitations } from "@/lib/ai/guard";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["statement_of_claim", "reply", "defense_memo", "petition", "contract"]),
  fields: z.record(z.string().max(4000)),
  notes: z.string().max(2000).default(""),
});

// Thin wrapper so anything thrown before a response is returned — a dropped
// DB connection during requireLawyer/getSession/hybridSearch chief among them
// — turns into the app's own Arabic error response instead of Next.js's
// default error page. Same pattern as chat/route.ts's POST/handlePost split.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[draft] unhandled error before response:", err);
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
  const { kind, notes } = parsed.data;

  // Keep only ids this kind declares. The form schema is the contract; a value
  // under an unknown key would reach the prompt with no label to explain it.
  const spec = fieldsOf(kind as DraftKind);
  const values: Record<string, string> = {};
  for (const f of spec) {
    const v = parsed.data.fields[f.id]?.trim();
    if (v) values[f.id] = v;
  }

  // A lawyer may skip the structured boxes entirely and describe the whole
  // matter in "ملاحظات إضافية" instead — substantial free text is enough to
  // proceed even with required boxes empty, since buildDraftPrompt already
  // organizes whatever mix of fields/notes it receives into the skeleton.
  const missing = spec.filter((f) => f.required && !values[f.id]);
  if (missing.length > 0 && !hasSubstantialNotes(notes)) {
    return Response.json({ error: `حقول مطلوبة ناقصة: ${missing.map((f) => f.label).join("، ")}` }, { status: 400 });
  }

  // The filled values are also the retrieval query: the subject line and the
  // facts are what decide which template and which articles come back.
  const instructions = [formatFields(kind as DraftKind, values), notes].filter(Boolean).join("\n");

  const { sessionId } = await getSession();
  const rl = await rateLimit(`draft:lawyer:${lawyer!.id}`, LIMITS.draft.limit, LIMITS.draft.windowSec);
  if (!rl.ok) {
    return Response.json({ error: "تجاوزت حد إنشاء المسودات. حاول لاحقاً." }, { status: 429 });
  }

  // Per-IP daily ceiling + cost circuit breakers — see costcap.ts and
  // ratelimit.ts's LIMITS.draftDailyIp for why this keys on IP rather than
  // the session cookie above.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const rlDailyIp = await rateLimit(`draft-daily-ip:${ipKey}`, LIMITS.draftDailyIp.limit, LIMITS.draftDailyIp.windowSec);
  if (!rlDailyIp.ok) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح به لإنشاء المسودات. حاول غداً." }, { status: 429 });
  }
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return Response.json({ error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي للموقع. حاول لاحقاً." }, { status: 503 });
  }
  if ((await costToday(ipKey)) >= env.costCapPerUserUsd) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح للإنفاق من هذا الاتصال. حاول غداً." }, { status: 429 });
  }

  await touchSession(sessionId);

  // Pull both the drafting templates and the substantive law behind them: a
  // claim needs its template's shape *and* the articles it will invoke.
  const [templates, law] = await Promise.all([
    hybridSearch(instructions, { sourceType: "template" }, 3),
    hybridSearch(instructions, {}, 6),
  ]);

  const seen = new Set<number>();
  const chunks = [...templates.chunks, ...law.chunks].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const embeddingTokens = templates.embeddingTokens + law.embeddingTokens;

  if (chunks.length === 0) {
    void recordUsage({
      sessionId,
      costKey: ipKey,
      question: `[مسودة: ${kind}] ${instructions.slice(0, 200)}`,
      answer: NO_BASIS_ANSWER,
      sourcesUsed: [],
      grounded: false,
      tokensIn: 0,
      tokensOut: 0,
      embeddingTokens,
      latencyMs: Date.now() - started,
      hitCount: 0,
    });
    return Response.json({ draft: NO_BASIS_ANSWER, grounded: false, sources: [] });
  }

  const { system, user } = buildDraftPrompt(kind as DraftKind, values, notes, chunks);
  const provider = getChatProvider();
  const result = await provider.chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // No temperature: current Claude models reject sampling params with a 400,
    // and the drafting rules that matter already live in the prompt.
    { maxTokens: 4000 }
  );

  const sources = chunks.map((c, i) => ({
    ref: i + 1,
    id: c.id,
    title: c.source_title,
    articleNumber: c.article_number,
    lawName: c.law_name,
    court: c.court,
    decisionNumber: c.decision_number,
    year: c.year,
    excerpt: c.chunk_text.slice(0, 400),
  }));

  // Same check as the chat route: a [9] in a filed legal document with only
  // 8 sources retrieved is a wrong citation, not a cosmetic slip — strip
  // anything the model wrote pointing past the actual source list.
  const { text: draft, strippedCount } = stripInvalidCitations(result.text, chunks.length);
  if (strippedCount > 0) {
    console.warn(`[draft] stripped ${strippedCount} out-of-range citation ref(s) — only ${chunks.length} source(s) were retrieved`);
  }

  void recordUsage({
    sessionId,
    costKey: ipKey,
    question: `[مسودة: ${kind}] ${instructions.slice(0, 200)}`,
    answer: draft,
    sourcesUsed: sources,
    grounded: true,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    embeddingTokens,
    latencyMs: Date.now() - started,
    hitCount: chunks.length,
  });

  return Response.json({ draft, grounded: true, sources });
}
