import { NextRequest } from "next/server";
import { z } from "zod";
import { loginLawyer } from "@/lib/lawyer-auth";
import { rateLimit } from "@/lib/ratelimit";
import { hashIp } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(2, "الاسم قصير جداً").max(120),
});

export async function POST(req: NextRequest) {
  // IP-keyed: the returning-visit flow only checks a name with no secret, so
  // this is the one endpoint in the app closest to a credential-guessing
  // target — same reasoning as admin/login/route.ts, tighter limit than
  // registration since there is no other friction here at all.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`lawyer-login:${hashIp(ip) ?? "unknown"}`, 10, 60 * 15);
  if (!rl.ok) {
    return Response.json({ error: "محاولات كثيرة. حاول لاحقاً." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }

  const result = await loginLawyer(parsed.data.name);
  if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
  return Response.json({ ok: true, lawyer: result.lawyer });
}
