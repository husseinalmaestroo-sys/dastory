import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";

/**
 * Signed, short-lived, request-bound caller assertions for trusted
 * server-to-server callers (Dostoori).
 *
 * WHY NOT A SHARED KEY + AN OFFICE-ID HEADER (the previous design)
 *
 * The old boundary was `X-Internal-Service-Key: <shared secret>` plus a plain
 * `X-Dostoori-Office-Id: <any string>`. Anyone holding the key — or any code
 * path that could add a header to an outbound request — could name ANY office,
 * and nothing tied the office to the request actually being made. A captured
 * request could be replayed forever.
 *
 * The assertion instead carries, under an HMAC-SHA256 signature:
 *   off / usr — the office and the authenticated Dastoori user,
 *   m / p     — the HTTP method and path it was minted for,
 *   bh        — SHA-256 of the exact request body,
 *   iat / exp — issue and expiry time (lifetime capped at MAX_LIFETIME_S),
 *   jti       — a random id, accepted once (service_request_nonces).
 * So a caller cannot pick another office without the signing key, an assertion
 * cannot be moved onto a different request or body, it expires within minutes,
 * and it cannot be replayed even inside that window.
 *
 * The signing key is INTERNAL_SERVICE_KEY (same secret as before, now used as
 * an HMAC key and never sent on the wire).
 */

export const ASSERTION_HEADER = "x-dostoori-assertion";

const ISSUER = "dostoori";
const AUDIENCE = "ailegal_hussein";
/** Longest lifetime an assertion may declare (exp - iat). */
export const MAX_LIFETIME_S = 120;
/** Clock skew tolerated between the two servers. */
const SKEW_S = 30;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ServicePrincipal = {
  kind: "service";
  officeId: string;
  userId: string;
  requestId: string;
};

type Payload = {
  v: 1;
  iss: string;
  aud: string;
  off: string;
  usr: string;
  jti: string;
  iat: number;
  exp: number;
  m: string;
  p: string;
  bh: string;
};

export type AssertionFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "wrong_audience"
  | "expired"
  | "not_yet_valid"
  | "lifetime_too_long"
  | "wrong_request"
  | "body_mismatch"
  | "bad_identity"
  | "replayed"
  | "not_configured";

export type VerifyResult = { ok: true; principal: ServicePrincipal } | { ok: false; reason: AssertionFailure };

const b64url = (buf: Buffer) => buf.toString("base64url");

export function bodyHash(body: Uint8Array | string): string {
  return b64url(createHash("sha256").update(body).digest());
}

function sign(key: string, payloadPart: string): string {
  return b64url(createHmac("sha256", key).update(`v1.${payloadPart}`).digest());
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Mints an assertion. Lives here (not only in Dastoori) so tests and the
 * evaluation harness exercise the exact verification contract; Dastoori keeps
 * a byte-compatible implementation in src/lib/ai/service-assertion.ts.
 */
export function mintAssertion(
  key: string,
  claims: { officeId: string; userId: string; method: string; path: string; body: Uint8Array | string; jti: string; now?: number; ttlS?: number }
): string {
  const iat = Math.floor((claims.now ?? Date.now()) / 1000);
  const payload: Payload = {
    v: 1,
    iss: ISSUER,
    aud: AUDIENCE,
    off: claims.officeId,
    usr: claims.userId,
    jti: claims.jti,
    iat,
    exp: iat + (claims.ttlS ?? 60),
    m: claims.method.toUpperCase(),
    p: claims.path,
    bh: bodyHash(claims.body),
  };
  const payloadPart = b64url(Buffer.from(JSON.stringify(payload)));
  return `v1.${payloadPart}.${sign(key, payloadPart)}`;
}

/** Pure part of verification (everything except the replay check). */
export function checkAssertion(
  token: string | null | undefined,
  key: string | null,
  req: { method: string; path: string; body: Uint8Array | string },
  now = Date.now()
): { ok: true; payload: Payload } | { ok: false; reason: AssertionFailure } {
  if (!key) return { ok: false, reason: "not_configured" };
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "malformed" };
  const [, payloadPart, sig] = parts;
  if (!safeEqual(sig, sign(key, payloadPart))) return { ok: false, reason: "bad_signature" };

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload?.v !== 1 || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) return { ok: false, reason: "wrong_audience" };
  const nowS = Math.floor(now / 1000);
  if (payload.exp - payload.iat > MAX_LIFETIME_S) return { ok: false, reason: "lifetime_too_long" };
  if (payload.iat > nowS + SKEW_S) return { ok: false, reason: "not_yet_valid" };
  if (payload.exp < nowS - SKEW_S) return { ok: false, reason: "expired" };
  if (payload.m !== req.method.toUpperCase() || payload.p !== req.path) return { ok: false, reason: "wrong_request" };
  if (!safeEqual(payload.bh ?? "", bodyHash(req.body))) return { ok: false, reason: "body_mismatch" };
  if (typeof payload.off !== "string" || !ID_RE.test(payload.off) || typeof payload.usr !== "string" || !ID_RE.test(payload.usr)) {
    return { ok: false, reason: "bad_identity" };
  }
  if (typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.jti)) return { ok: false, reason: "malformed" };
  return { ok: true, payload };
}

/**
 * Records the assertion id; false when it was already used (a replay).
 * Expired ids are pruned opportunistically.
 */
async function claimNonce(jti: string, expSeconds: number): Promise<boolean> {
  const rows = await query<{ jti: string }>(
    `INSERT INTO service_request_nonces (jti, expires_at)
     VALUES ($1, to_timestamp($2))
     ON CONFLICT (jti) DO NOTHING
     RETURNING jti`,
    [jti, expSeconds + SKEW_S]
  );
  if (Math.random() < 0.02) {
    void query(`DELETE FROM service_request_nonces WHERE expires_at < now()`).catch(() => {});
  }
  return rows.length === 1;
}

export async function verifyServiceAssertion(
  token: string | null | undefined,
  key: string | null,
  req: { method: string; path: string; body: Uint8Array | string }
): Promise<VerifyResult> {
  const checked = checkAssertion(token, key, req);
  if (!checked.ok) return checked;
  const { payload } = checked;
  if (!(await claimNonce(payload.jti, payload.exp))) return { ok: false, reason: "replayed" };
  return {
    ok: true,
    principal: { kind: "service", officeId: payload.off, userId: payload.usr, requestId: payload.jti },
  };
}
