import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession } from "@/lib/session";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes } from "@/lib/http";
import { admit, failureResponse, runAiRequest } from "@/lib/ai/request";
import { runCaseAnalysis } from "@/lib/ai/pipelines/documents";
import { savePdf } from "@/lib/storage";
import { extractPdfText } from "@/lib/ingest/extract";
import { cleanText } from "@/lib/ingest/clean";
import { query } from "@/lib/db";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OCR on a scanned case file is slow; the default 30s would kill it mid-page.
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_CASE_TEXT_CHARS = 400_000;

/**
 * Two input forms:
 *   • JSON { caseText, fileName? } — text already extracted by the caller
 *     (Dostoori extracts with its own pipeline, OCR included). Nothing but the
 *     text leaves Dostoori, and nothing is stored here.
 *   • multipart { file } — a PDF, for the standalone app, extracted here.
 *     Only a standalone user's upload is retained (uploaded_cases + the PDF),
 *     and only for CONTENT_RETENTION_DAYS (scripts/purge-content.ts).
 */
const JsonBody = z.object({
  caseText: z.string().min(100, "نص الملف قصير جداً").max(MAX_CASE_TEXT_CHARS),
  fileName: z.string().max(200).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[cases] unhandled error before response:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const body = await readBodyLimited(req, MAX_UPLOAD_BYTES);
  if (!body.ok) return body.response;

  const auth = await requireCaller(req, body.bytes);
  if (auth.response) return auth.response;
  const caller = auth.caller;

  const isMultipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  let caseText: string;
  let fileName = "ملف قضية";
  let pdf: File | null = null;
  let extraction: { pages: number; method: string } = { pages: 0, method: "provided-text" };

  if (isMultipart) {
    const form = await new Request(req.url, { method: "POST", headers: req.headers, body: Buffer.from(body.bytes) }).formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "لم يتم إرفاق ملف." }, { status: 400 });
    pdf = file;
    fileName = file.name.slice(0, 200);
    try {
      const extracted = await extractPdfText(Buffer.from(await file.arrayBuffer()));
      caseText = cleanText(extracted.text);
      extraction = { pages: extracted.pages, method: extracted.method };
    } catch {
      return Response.json({ error: "تعذّر قراءة الملف. تأكد أنه ملف PDF سليم." }, { status: 400 });
    }
  } else {
    const parsed = JsonBody.safeParse(parseJsonBytes(body.bytes));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
    caseText = cleanText(parsed.data.caseText);
    fileName = parsed.data.fileName ?? fileName;
  }
  if (caseText.length < 100) {
    return Response.json({ error: "تعذّر استخراج نص كافٍ من الملف. تأكد من وضوح المستند." }, { status: 400 });
  }

  const refused = await admit(caller, "case_analysis");
  if (refused) return refused;

  const r = await runAiRequest(caller, "case_analysis", req.signal, () => runCaseAnalysis(caseText, caller));
  if (!r.ok) return failureResponse(r);
  const v = r.value;
  if ("invalid" in v) {
    return Response.json({ error: "تعذّر الحصول على تحليل صالح لهذا الملف. حاول مرة أخرى.", requestId: r.usage.requestId }, { status: 502 });
  }

  let id: number | null = null;
  if (caller.retainContent && pdf) {
    // Standalone users only: their own upload history (retention-limited).
    const { sessionId } = await getSession();
    void touchSession(sessionId);
    try {
      const saved = await savePdf(pdf, "cases");
      const row = await query<{ id: number }>(
        `INSERT INTO uploaded_cases (session_id, file_name, file_path, extracted_text, analysis, status)
         VALUES ($1,$2,$3,$4,$5,'ready') RETURNING id`,
        [sessionId, saved.name, saved.path, caseText, JSON.stringify({ ...v.analysis, sources: v.sources })]
      );
      id = row[0]?.id ?? null;
      void recordUsage({
        sessionId,
        question: `[تحليل ملف قضية] ${saved.name}`,
        answer: JSON.stringify(v.analysis).slice(0, 4000),
        sourcesUsed: v.sources.filter((s) => s.cited),
        grounded: v.groundingLevel !== "none",
        mode: v.groundingLevel,
        tokensIn: r.usage.tokensIn,
        tokensOut: r.usage.tokensOut,
        embeddingTokens: r.usage.embeddingTokens,
        latencyMs: 0,
        category: v.analysis.case_type,
        hitCount: v.sources.length,
        costUsd: r.usage.estimatedCostUsd,
      });
    } catch (err) {
      logError("[cases] failed to store the standalone upload:", err);
    }
  }

  return Response.json({
    id,
    fileName,
    pages: extraction.pages,
    extractionMethod: extraction.method,
    analysis: v.analysis,
    validation: v.validation,
    coverage: v.coverage,
    groundingLevel: v.groundingLevel,
    sources: v.sources,
    usage: r.usage,
    provenance: r.provenance,
  });
}
