import { NextRequest } from "next/server";
import { checkPassword, setAdminCookie, clearAdminCookie } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/ratelimit";
import { hashIp } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Keyed by IP, not session: a cookie is attacker-controlled, so a
  // session-keyed limit on a login endpoint is no limit at all.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`admin-login:${hashIp(ip) ?? "unknown"}`, 5, 60 * 15);
  if (!rl.ok) {
    return Response.json({ error: "محاولات كثيرة. حاول لاحقاً." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!checkPassword(password)) {
    return Response.json({ error: "كلمة المرور غير صحيحة." }, { status: 401 });
  }

  await setAdminCookie();
  return Response.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return Response.json({ ok: true });
}
