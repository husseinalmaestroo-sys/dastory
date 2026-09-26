import "server-only";
import { headers } from "next/headers";
import { env } from "./env";
import { getLawyer, type Lawyer } from "./lawyer-auth";
import { hashIp } from "./session";
import { logError } from "./error-log";
import { ASSERTION_HEADER, verifyServiceAssertion, type ServicePrincipal } from "./service-auth";

/**
 * Who is calling an AI endpoint, and the keys every downstream guard uses.
 *
 * Two kinds of caller:
 *   lawyer  — a standalone user of this app (signed cookie, lawyer-auth.ts).
 *   service — Dostoori, calling on behalf of one authenticated user in one
 *             office, proven by a signed request-bound assertion
 *             (service-auth.ts).
 *
 * The distinction drives more than auth:
 *   • limits: a service caller is bucketed per office (cost) and per office
 *     user (rate). Keying Dostoori on client IP put EVERY office behind one
 *     server address into one bucket — 150 questions/day and $2/day shared
 *     by all of them.
 *   • retention: `retainContent` is false for service callers. Dostoori is
 *     the system of record for its offices' questions, contracts and case
 *     files; this service processes them and keeps only metadata (no text,
 *     no files) — nothing here to leak, export, or forget to delete.
 */
export type Caller =
  | {
      kind: "lawyer";
      lawyer: Lawyer;
      /** Rate-limit key prefix, unique per person. */
      rateKey: string;
      /** Daily USD cap bucket. */
      costKey: string;
      costCapUsd: number;
      retainContent: true;
      /** Salted IP hash for per-connection abuse limits (standalone only). */
      ipKey: string;
    }
  | {
      kind: "service";
      principal: ServicePrincipal;
      rateKey: string;
      costKey: string;
      costCapUsd: number;
      retainContent: false;
      ipKey: null;
    };

const LEGACY_HEADERS = ["x-internal-service-key", "x-dostoori-office-id"];

/**
 * The client address for per-connection limits. Only trusted from X-Real-IP
 * set by our own reverse proxy (TRUST_PROXY=1); X-Forwarded-For's first entry
 * is whatever the client wrote. Without a trusted proxy every request shares
 * one bucket — fail-safe (limits still apply), never spoofable.
 */
export function clientIpFrom(h: Headers): string {
  if (process.env.TRUST_PROXY !== "1") return "direct";
  const real = h.get("x-real-ip")?.trim();
  return real && /^[0-9a-fA-F:.]{2,45}$/.test(real) ? real : "unknown";
}

const unauthorized = (message = "الرجاء تسجيل الدخول أولاً.") => Response.json({ error: message }, { status: 401 });

/**
 * Authenticates the caller. `rawBody` must be the exact request body bytes —
 * a service assertion is bound to them.
 */
export async function requireCaller(
  req: { method: string; url: string },
  rawBody: Uint8Array | string
): Promise<{ response: Response; caller: null } | { response: null; caller: Caller }> {
  const h = await headers();

  // The retired shared-key scheme fails closed instead of silently falling
  // through to cookie auth: a caller still sending it is misconfigured.
  if (LEGACY_HEADERS.some((name) => h.get(name))) {
    logError("[auth] rejected a request using the retired x-internal-service-key/x-dostoori-office-id scheme", null);
    return { response: unauthorized("طريقة المصادقة الداخلية القديمة لم تعد مقبولة."), caller: null };
  }

  const assertion = h.get(ASSERTION_HEADER);
  if (assertion) {
    const path = new URL(req.url).pathname;
    const result = await verifyServiceAssertion(assertion, env.internalServiceKey, { method: req.method, path, body: rawBody });
    if (!result.ok) {
      // The reason is logged for operators, never returned (it would tell an
      // attacker which check to work on next).
      logError(`[auth] service assertion rejected: ${result.reason}`, null);
      return { response: unauthorized("تعذّر التحقق من هوية الجهة المتصلة."), caller: null };
    }
    const p = result.principal;
    return {
      response: null,
      caller: {
        kind: "service",
        principal: p,
        rateKey: `svc:${p.officeId}:${p.userId}`,
        costKey: `office:${p.officeId}`,
        costCapUsd: env.costCapPerOfficeUsd,
        retainContent: false,
        ipKey: null,
      },
    };
  }

  const lawyer = await getLawyer();
  if (!lawyer) return { response: unauthorized(), caller: null };
  const ipKey = hashIp(clientIpFrom(h)) ?? "unknown";
  return {
    response: null,
    caller: {
      kind: "lawyer",
      lawyer,
      rateKey: `lawyer:${lawyer.id}`,
      costKey: ipKey,
      costCapUsd: env.costCapPerUserUsd,
      retainContent: true,
      ipKey,
    },
  };
}

/** Stable, non-reversible label for logs/analytics — never the raw office/user id. */
export function callerLabel(caller: Caller): string {
  return caller.kind === "service" ? `office:${hashIp(caller.principal.officeId)?.slice(0, 12)}` : `lawyer:${caller.lawyer.id}`;
}
