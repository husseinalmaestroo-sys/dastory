import { NextRequest } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/caller";
import { readBodyLimited, parseJsonBytes } from "@/lib/http";
import { admit } from "@/lib/ai/request";
import { draftToDocx } from "@/lib/drafting/export";
import { draftToPdf } from "@/lib/drafting/pdf";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  draft: z.string().min(1).max(20000),
  filename: z.string().min(1).max(120).default("مسودة"),
  format: z.enum(["docx", "pdf"]).default("docx"),
});

/**
 * Renders a draft to DOCX/PDF. Phase 2: authenticated (it was open to anyone —
 * a free headless-Chrome PDF renderer, rate-limited only per session cookie,
 * which a caller mints at will). Stateless: nothing is stored.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await readBodyLimited(req, 128 * 1024);
    if (!body.ok) return body.response;
    const auth = await requireCaller(req, body.bytes);
    if (auth.response) return auth.response;

    const parsed = Body.safeParse(parseJsonBytes(body.bytes));
    if (!parsed.success) return Response.json({ error: "طلب غير صالح" }, { status: 400 });

    const refused = await admit(auth.caller, "draft_export");
    if (refused) return refused;

    const { draft, filename, format } = parsed.data;
    const safeName = encodeURIComponent(filename.replace(/[\r\n"]/g, " "));
    if (format === "pdf") {
      const buffer = await draftToPdf(draft);
      return new Response(buffer as unknown as BodyInit, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName}.pdf"` },
      });
    }
    const buffer = await draftToDocx(draft);
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      },
    });
  } catch (err) {
    logError("[draft/export] failed:", err);
    return Response.json({ error: "تعذّر تصدير الملف." }, { status: 500 });
  }
}
