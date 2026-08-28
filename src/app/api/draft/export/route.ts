import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession } from "@/lib/session";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { draftToDocx } from "@/lib/drafting/export";
import { draftToPdf } from "@/lib/drafting/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  draft: z.string().min(1).max(20000),
  filename: z.string().min(1).max(120).default("مسودة"),
  format: z.enum(["docx", "pdf"]).default("docx"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const { sessionId } = await getSession();
  const rl = await rateLimit(`draft-export:${sessionId}`, LIMITS.draft.limit, LIMITS.draft.windowSec);
  if (!rl.ok) {
    return Response.json({ error: "تجاوزت حد التصدير. حاول لاحقاً." }, { status: 429 });
  }
  await touchSession(sessionId);

  const { draft, filename, format } = parsed.data;

  if (format === "pdf") {
    const buffer = await draftToPdf(draft);
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}.pdf"`,
      },
    });
  }

  const buffer = await draftToDocx(draft);
  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}.docx"`,
    },
  });
}
