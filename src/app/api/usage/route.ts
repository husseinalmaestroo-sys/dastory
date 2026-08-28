import { NextRequest } from "next/server";
import { requireLawyer } from "@/lib/lawyer-auth";
import { hashIp } from "@/lib/session";
import { costToday } from "@/lib/costcap";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How close the caller's IP is to today's spending cap — as a bare percentage,
 * nothing else. Deliberately never returns the dollar figures behind it (the
 * amount spent, or the cap itself): the lawyer-facing meter this feeds is a
 * "how much of today is left" indicator, not a billing view, and the surest
 * way to keep it that way is to never put a dollar amount on the wire in the
 * first place — no redaction step to forget, nothing to leak.
 */
export async function GET(req: NextRequest) {
  const { response: authError } = await requireLawyer();
  if (authError) return authError;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const cap = env.costCapPerUserUsd;
  // A 0 cap (the emergency kill switch — see env.ts) means every request is
  // already refused, i.e. fully used up, not a division by zero.
  //
  // One decimal place, not a whole number: measured live, a single clean
  // grounded question costs ~$0.01-0.03 against the $2 default cap — 0.5-1.5%
  // of it. Rounded to a whole percent, most individual questions display as
  // "0%" and the meter looks frozen even though the underlying tracking is
  // exact; one decimal (0.1% resolution, i.e. $0.002 against the default cap)
  // is fine-grained enough to visibly move on every question.
  const pct = cap > 0 ? Math.min(100, Math.round(((await costToday(ipKey)) / cap) * 1000) / 10) : 100;

  return Response.json({ pct });
}
