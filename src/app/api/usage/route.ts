import { NextRequest } from "next/server";
import { requireCaller } from "@/lib/caller";
import { costToday } from "@/lib/costcap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How close the caller is to today's spending cap — as a bare percentage,
 * never the dollar figures behind it. The bucket is the caller's own: the
 * connection for a standalone lawyer, the office for a Dostoori call (it used
 * to read a client-supplied X-Forwarded-For).
 */
export async function GET(req: NextRequest) {
  const auth = await requireCaller(req, "");
  if (auth.response) return auth.response;
  const caller = auth.caller;
  const cap = caller.costCapUsd;
  // A 0 cap (the emergency kill switch — see env.ts) means fully used up.
  const pct = cap > 0 ? Math.min(100, Math.round(((await costToday(caller.costKey)) / cap) * 1000) / 10) : 100;
  return Response.json({ pct });
}
