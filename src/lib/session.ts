import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { nanoid } from "nanoid";
import { env } from "./env";
import { query } from "./db";
import { logError } from "./error-log";

export const SESSION_COOKIE = "als_sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/**
 * Salted SHA-256 of the client IP.
 *
 * The salt is what makes this a one-way identifier rather than a lookup table:
 * IPv4 has only 4 billion values, so an unsalted hash is trivially reversible
 * by brute force and would be personal data in every sense that matters.
 * We keep it only to estimate distinct visitors.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(env.ipHashSalt).update(ip).digest("hex").slice(0, 32);
}

function clientIp(h: Headers): string | null {
  // Behind nginx on the VPS, the socket address is always 127.0.0.1 — the real
  // client is in the proxy headers.
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? null;
}

export type Session = { sessionId: string; isNew: boolean };

/** Reads the session cookie, minting one if absent. Safe in route handlers. */
export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing) return { sessionId: existing, isNew: false };

  const sessionId = nanoid(21);
  jar.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return { sessionId, isNew: true };
}

/**
 * Upserts the session's usage row. Call once per request that does work.
 *
 * Fire-and-forget by design, same convention as analytics.ts's recordUsage:
 * nothing in the request reads this row back before responding (chat_history
 * has no foreign key on session_id — see db/schema.sql — so recordUsage's own
 * insert never depends on this having run first), so a caller should start it
 * alongside the retrieval pipeline rather than await it up front. Measured in
 * scripts/tmp-timing-e2e.ts: awaiting this before the rules/expansion/search
 * pipeline (its previous call site in route.ts) added a full sequential DB
 * round-trip to every request's retrieval latency for a write nothing in the
 * response depends on. Errors are swallowed and logged, never thrown, so a
 * transient DB hiccup here can never fail the user's actual question.
 */
export async function touchSession(sessionId: string): Promise<void> {
  try {
    const h = await headers();
    const ipHash = hashIp(clientIp(h));
    const ua = h.get("user-agent")?.slice(0, 300) ?? null;

    await query(
      `INSERT INTO anonymous_usage (session_id, ip_hash, user_agent)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id)
       DO UPDATE SET last_seen_at = now(),
                     ip_hash    = COALESCE(anonymous_usage.ip_hash, EXCLUDED.ip_hash),
                     user_agent = COALESCE(anonymous_usage.user_agent, EXCLUDED.user_agent)`,
      [sessionId, ipHash, ua]
    );
  } catch (err) {
    logError("[session] failed to touch session:", err);
  }
}
