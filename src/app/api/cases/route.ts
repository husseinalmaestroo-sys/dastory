import { NextRequest } from "next/server";
import { getSession, touchSession, hashIp } from "@/lib/session";
import { requireLawyer } from "@/lib/lawyer-auth";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { costToday, siteWideCostToday } from "@/lib/costcap";
import { env } from "@/lib/env";
import { savePdf } from "@/lib/storage";
import { extractPdfText } from "@/lib/ingest/extract";
import { cleanText } from "@/lib/ingest/clean";
import { query, queryOne } from "@/lib/db";
import { hybridSearch } from "@/lib/search/hybrid";
import { getChatProvider } from "@/lib/ai";
import { buildCaseAnalysisPrompt } from "@/lib/ai/prompts";
import { stripInvalidCitations } from "@/lib/ai/guard";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OCR on a scanned case file is slow; the default 30s would kill it mid-page.
export const maxDuration = 300;

// The retrieval query is built from the case text. Sending all of it would
// blow the embedding model's input limit on a long file, and the first pages
// (parties, subject, claim) carry the signal anyway.
const QUERY_TEXT_CHARS = 3000;
// What the analysis model actually reads. A 40-page case at full length is
// ~30k tokens per request — the cap keeps a single upload from costing more
// than a hundred chat questions.
const ANALYSIS_TEXT_CHARS = 24_000;

// Thin wrapper so anything thrown before a response is returned — a dropped
// DB connection during requireLawyer/getSession/hybridSearch chief among them
// — turns into the app's own Arabic error response instead of Next.js's
// default error page. Same pattern as chat/route.ts's POST/handlePost split.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[cases] unhandled error before response:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const started = Date.now();

  const { response: authError, lawyer } = await requireLawyer();
  if (authError) return authError;

  const { sessionId } = await getSession();

  const rl = await rateLimit(`upload:lawyer:${lawyer!.id}`, LIMITS.upload.limit, LIMITS.upload.windowSec);
  if (!rl.ok) {
    return Response.json(
      { error: `تجاوزت حد رفع الملفات. حاول بعد ${Math.ceil(rl.retryAfterSec / 60)} دقيقة.` },
      { status: 429 }
    );
  }

  // Per-IP daily ceiling + cost circuit breakers — see costcap.ts and
  // ratelimit.ts's LIMITS.uploadDailyIp for why this keys on IP rather than
  // the session cookie above.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const rlDailyIp = await rateLimit(`upload-daily-ip:${ipKey}`, LIMITS.uploadDailyIp.limit, LIMITS.uploadDailyIp.windowSec);
  if (!rlDailyIp.ok) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح به لرفع الملفات. حاول غداً." }, { status: 429 });
  }
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return Response.json({ error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي للموقع. حاول لاحقاً." }, { status: 503 });
  }
  if ((await costToday(ipKey)) >= env.costCapPerUserUsd) {
    return Response.json({ error: "تجاوزت الحد اليومي المسموح للإنفاق من هذا الاتصال. حاول غداً." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "لم يتم إرفاق ملف." }, { status: 400 });
  }

  await touchSession(sessionId);

  let caseId: number | null = null;
  try {
    const saved = await savePdf(file, "cases");

    const row = await queryOne<{ id: number }>(
      `INSERT INTO uploaded_cases (session_id, file_name, file_path, status)
       VALUES ($1,$2,$3,'processing') RETURNING id`,
      [sessionId, saved.name, saved.path]
    );
    caseId = row!.id;

    const extracted = await extractPdfText(await readBack(saved.path));
    const text = cleanText(extracted.text);

    if (text.length < 100) {
      throw new Error("تعذّر استخراج نص كافٍ من الملف. تأكد من وضوح المستند.");
    }

    await query(`UPDATE uploaded_cases SET extracted_text = $2 WHERE id = $1`, [caseId, text]);

    // Ground the analysis in the shared knowledge base — the uploaded file is
    // evidence to be analysed, never an authority to cite.
    const { chunks, embeddingTokens } = await hybridSearch(text.slice(0, QUERY_TEXT_CHARS), {}, 10);

    const { system, user } = buildCaseAnalysisPrompt(text.slice(0, ANALYSIS_TEXT_CHARS), chunks);
    const provider = getChatProvider();
    const result = await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 2500 }
    );

    const analysis = parseJsonAnalysis(result.text);

    // Same check chat/route.ts and draft/route.ts run on inline [n] markers —
    // legal_basis/possible_defenses/strengths/weaknesses each carry a
    // `citation: "[n]"` pointing into this same retrieved `chunks` array, but
    // unlike those two routes nothing here verified the ref was in range. A
    // `[7]` with only 3 sources retrieved is a fabricated citation in a
    // document meant to inform litigation strategy, not a cosmetic slip.
    const strippedCount = cleanCitationRefs(analysis, chunks.length);
    if (strippedCount > 0) {
      console.warn(
        `[cases] stripped ${strippedCount} out-of-range citation ref(s) — only ${chunks.length} source(s) were retrieved`
      );
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

    await query(`UPDATE uploaded_cases SET analysis = $2, status = 'ready' WHERE id = $1`, [
      caseId,
      JSON.stringify({ ...analysis, sources }),
    ]);

    void recordUsage({
      sessionId,
      costKey: ipKey,
      question: `[تحليل ملف قضية] ${saved.name}`,
      answer: JSON.stringify(analysis).slice(0, 4000),
      sourcesUsed: sources,
      grounded: chunks.length > 0,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      embeddingTokens,
      latencyMs: Date.now() - started,
      category: analysis.case_type ?? null,
      hitCount: chunks.length,
    });

    return Response.json({
      id: caseId,
      fileName: saved.name,
      pages: extracted.pages,
      extractionMethod: extracted.method,
      analysis,
      sources,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل تحليل الملف.";
    if (caseId) {
      await query(`UPDATE uploaded_cases SET status = 'failed', error = $2 WHERE id = $1`, [
        caseId,
        message.slice(0, 500),
      ]).catch(() => {});
    }
    logError("[cases] analysis failed:", err);
    return Response.json({ error: message }, { status: 400 });
  }
}

async function readBack(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}

/**
 * The prompt demands bare JSON, but models still wrap it in ```json fences
 * often enough that failing the whole upload over it is not acceptable.
 */
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
  // Surface the model's prose rather than throwing away a paid call.
  return { summary: raw.slice(0, 2000), parse_error: true };
}

/**
 * Validates the `citation: "[n]"` field on every legal_basis/possible_
 * defenses/strengths/weaknesses entry against the retrieved `chunks` array —
 * reusing guard.ts's stripInvalidCitations rather than a second regex, since
 * a ref pointing past the source list is exactly as invalid here as it is in
 * chat/route.ts's or draft/route.ts's inline [n] markers. `cited_articles` is
 * deliberately left untouched: per buildCaseAnalysisPrompt, it describes
 * articles as they appeared in the *uploaded* case file, not a DB reference.
 */
function cleanCitationRefs(analysis: Record<string, any>, maxRef: number): number {
  let strippedCount = 0;
  for (const key of ["legal_basis", "possible_defenses", "strengths", "weaknesses"]) {
    const items = analysis[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.citation !== "string") continue;
      const { text, strippedCount: n } = stripInvalidCitations(item.citation, maxRef);
      strippedCount += n;
      item.citation = text || undefined;
    }
  }
  return strippedCount;
}
