import { clearLawyerCookie } from "@/lib/lawyer-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearLawyerCookie();
  return Response.json({ ok: true });
}
