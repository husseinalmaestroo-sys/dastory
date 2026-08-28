import { NextRequest } from "next/server";
import { z } from "zod";
import { registerLawyer } from "@/lib/lawyer-auth";
import { rateLimit } from "@/lib/ratelimit";
import { hashIp } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(2, "الاسم قصير جداً").max(120),
  phone: z.string().min(7, "رقم الهاتف غير صالح").max(30),
  officeName: z.string().max(200).optional().default(""),
});

export async function POST(req: NextRequest) {
  // IP-keyed, not session-keyed: a cookie is attacker-controlled, so a
  // session-keyed limit on an account-creation endpoint is no limit at all —
  // same reasoning as admin/login/route.ts.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`lawyer-register:${hashIp(ip) ?? "unknown"}`, 8, 60 * 60);
  if (!rl.ok) {
    return Response.json({ error: "محاولات كثيرة. حاول لاحقاً." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }

  const result = await registerLawyer(parsed.data);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true, lawyer: result.lawyer });
}
