import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession, hashIp } from "@/lib/session";
import { requireLawyer } from "@/lib/lawyer-auth";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { costToday, siteWideCostToday } from "@/lib/costcap";
import { env } from "@/lib/env";
import { hybridSearch } from "@/lib/search/hybrid";
import { getChatProvider } from "@/lib/ai";
import { buildContractReviewPrompt } from "@/lib/ai/prompts";
import { stripInvalidCitations } from "@/lib/ai/guard";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Real contracts run well past a typical chat question's length — same
// reasoning as cases/route.ts's ANALYSIS_TEXT_CHARS, sized for the analysis
// call specifically (the retrieval query below uses a smaller slice).
const QUERY_TEXT_CHARS = 3000;
const ANALYSIS_TEXT_CHARS = 24_000;

const Body = z.object({
  // Text, not a file: the caller (Dostoori) already extracted it with its
  // own real pipeline (OCR fallback included) — sending a second copy of
  // that extraction logic here would duplicate, not reuse, existing work.
  contractText: z.string().min(20, "نص العقد قصير جداً").max(200_000),
});

// Same thin-wrapper pattern as chat/cases/draft: anything thrown before a
// response is returned becomes the app's own Arabic error response instead
// of Next.js's default error page.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[contract-review] unhandled error before response:", err);
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
  const contractText = parsed.data.contractText.slice(0, ANALYSIS_TEXT_CHARS);
  const truncated = parsed.data.contractText.length > ANALYSIS_TEXT_CHARS;

  const { sessionId } = await getSession();
  const rl = await rateLimit(`contract-review:lawyer:${lawyer!.id}`, LIMITS.upload.limit, LIMITS.upload.windowSec);
  if (!rl.ok) {
    return Response.json({ error: `تجاوزت الحد المسموح. حاول بعد ${Math.ceil(rl.retryAfterSec / 60)} دقيقة.` }, { status: 429 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const rlDailyIp = await rateLimit(`contract-review-daily-ip:${ipKey}`, LIMITS.uploadDailyIp.limit, LIMITS.uploadDailyIp.windowSec);
  if (!rlDailyIp.ok) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح به. حاول غداً." }, { status: 429 });
  }
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return Response.json({ error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي للموقع. حاول لاحقاً." }, { status: 503 });
  }
  if ((await costToday(ipKey)) >= env.costCapPerUserUsd) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح للإنفاق من هذا الاتصال. حاول غداً." }, { status: 429 });
  }

  await touchSession(sessionId);

  try {
    // Grounding is optional here, unlike chat/cases: a contract with zero
    // retrieved sources is still a contract worth summarizing (see the
    // prompt's own "no full-refusal" override) — hybridSearch still runs so
    // any genuinely relevant law (e.g. a termination clause matching real
    // Labor Law provisions) can be cited, not to gate the response.
    const { chunks, embeddingTokens } = await hybridSearch(contractText.slice(0, QUERY_TEXT_CHARS), {}, 8);

    const { system, user } = buildContractReviewPrompt(contractText, chunks);
    const provider = getChatProvider();
    const result = await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 3000 }
    );

    const analysis = parseJsonAnalysis(result.text);
    const strippedCount = cleanRiskCitations(analysis, chunks.length);
    if (strippedCount > 0) {
      console.warn(`[contract-review] stripped ${strippedCount} out-of-range citation ref(s) — only ${chunks.length} source(s) were retrieved`);
    }

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

    void recordUsage({
      sessionId,
      costKey: ipKey,
      question: `[مراجعة عقد] ${contractText.slice(0, 200)}`,
      answer: JSON.stringify(analysis).slice(0, 4000),
      sourcesUsed: sources,
      grounded: chunks.length > 0,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      embeddingTokens,
      latencyMs: Date.now() - started,
      hitCount: chunks.length,
    });

    return Response.json({ ...analysis, truncated, sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل تحليل العقد.";
    logError("[contract-review] analysis failed:", err);
    return Response.json({ error: message }, { status: 400 });
  }
}

/** Same tolerant-parse strategy as cases/route.ts's parseJsonAnalysis — the prompt demands bare JSON, but models still wrap it in ```json fences often enough that failing the whole review over it is not acceptable. */
function parseJsonAnalysis(raw: string): Record<string, any> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  return { summary: raw.slice(0, 2000), parties: [], keyTerms: [], risks: [], parse_error: true };
}

/**
 * Validates any `[n]` citation inside each risk's `explanation` against the
 * retrieved `chunks` array, reusing guard.ts's stripInvalidCitations —
 * same reasoning as cases/route.ts's cleanCitationRefs. `excerpt` is
 * deliberately left untouched: per the prompt, it quotes the *uploaded
 * contract* verbatim, not a database reference — Dostoori's own route
 * re-verifies that excerpt actually appears in the contract text it sent,
 * on its own side, same as it already did calling Claude directly.
 */
function cleanRiskCitations(analysis: Record<string, any>, maxRef: number): number {
  let strippedCount = 0;
  const risks = analysis.risks;
  if (!Array.isArray(risks)) return 0;
  for (const risk of risks) {
    if (!risk || typeof risk.explanation !== "string") continue;
    const { text, strippedCount: n } = stripInvalidCitations(risk.explanation, maxRef);
    strippedCount += n;
    risk.explanation = text;
  }
  return strippedCount;
}
