import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { env } from "./env";
import { query, queryOne } from "./db";
import { foldForSearch } from "./ingest/clean";

const INTERNAL_KEY_HEADER = "x-internal-service-key";
const INTERNAL_CALLER_HEADER = "x-dostoori-office-id";

const LAWYER_COOKIE = "als_lawyer";
const TTL_MS = 1000 * 60 * 60 * 24 * 180; // 180 days — a lawyer re-enters only their name, so there is little reason to force it sooner.

export type Lawyer = {
  id: number;
  name: string;
  phone: string | null;
  officeName: string | null;
};

/**
 * Same fold search already uses for statute text (alef/ya/ta-marbuta
 * variants, lowercased) plus whitespace collapse, so "أحمد  الحسن" and
 * "احمد الحسن" resolve to the same person instead of quietly registering
 * two rows — and so a genuine second "أحمد الحسن" collides loudly (a unique
 * index violation) rather than silently merging into the first one's history.
 */
export function normalizeLawyerName(name: string): string {
  return foldForSearch(name.trim().replace(/\s+/g, " "));
}

// Signed cookie, same shape as admin-auth.ts's token (expires.HMAC(payload))
// but carrying a lawyer id instead of gating on a shared password — a lawyer
// never enters a secret, so this only needs to prove the cookie was minted by
// this server for this id, not that the holder knows anything.
function sign(payload: string): string {
  return createHmac("sha256", env.lawyerSessionSecret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function issueToken(lawyerId: number): string {
  const expires = Date.now() + TTL_MS;
  const payload = `${lawyerId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): number | null {
  if (!token) return null;
  const [idRaw, expiresRaw, sig] = token.split(".");
  if (!idRaw || !expiresRaw || !sig) return null;

  const expires = Number(expiresRaw);
  const id = Number(idRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  if (!Number.isInteger(id) || id <= 0) return null;

  if (!safeEqual(sig, sign(`${idRaw}.${expiresRaw}`))) return null;
  return id;
}

async function setLawyerCookie(lawyerId: number): Promise<void> {
  const jar = await cookies();
  jar.set(LAWYER_COOKIE, issueToken(lawyerId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS / 1000,
    path: "/",
  });
}

export async function clearLawyerCookie(): Promise<void> {
  (await cookies()).delete(LAWYER_COOKIE);
}

/** The signed-in lawyer, or null — never throws, safe to call unconditionally. */
export async function getLawyer(): Promise<Lawyer | null> {
  const jar = await cookies();
  const id = verifyToken(jar.get(LAWYER_COOKIE)?.value);
  if (!id) return null;

  const row = await queryOne<{ id: number; name: string; phone: string | null; office_name: string | null }>(
    `SELECT id, name, phone, office_name FROM users WHERE id = $1 AND role = 'lawyer'`,
    [id]
  );
  if (!row) return null;
  return { id: row.id, name: row.name, phone: row.phone, officeName: row.office_name };
}

/**
 * One stable row per calling office, not per Dostoori end-user: a Dostoori
 * office's many lawyers all share this app's rate limit / cost bucket /
 * chat_history the same way a single real lawyer using this app directly
 * would. That's a deliberate, coarser grain than Dostoori's own per-user
 * limits (which already ran, upstream, before this was ever called) — the
 * purpose here is only to keep one Dostoori office's usage from bucketing
 * together with another's, or with a real walk-in lawyer's, inside THIS
 * app's own limits. Idempotent: a second call for the same officeId finds
 * the row idx_users_name_key already guarantees is unique, rather than
 * risking a duplicate insert.
 */
async function getOrCreateInternalLawyer(officeId: string): Promise<Lawyer> {
  const nameKey = normalizeLawyerName(`dostoori-office-${officeId}`);
  const existing = await queryOne<{ id: number; name: string; phone: string | null; office_name: string | null }>(
    `SELECT id, name, phone, office_name FROM users WHERE name_key = $1`,
    [nameKey]
  );
  if (existing) return { id: existing.id, name: existing.name, phone: existing.phone, officeName: existing.office_name };

  const displayName = `Dostoori — office ${officeId}`;
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO users (name, name_key, office_name, role) VALUES ($1, $2, $3, 'lawyer') RETURNING id`,
      [displayName, nameKey, "Dostoori (integration)"]
    );
    return { id: row!.id, name: displayName, phone: null, officeName: "Dostoori (integration)" };
  } catch {
    // Lost a race with a concurrent first request for the same office against
    // idx_users_name_key's unique constraint — the row now exists, read it.
    const row = await queryOne<{ id: number; name: string; phone: string | null; office_name: string | null }>(
      `SELECT id, name, phone, office_name FROM users WHERE name_key = $1`,
      [nameKey]
    );
    if (row) return { id: row.id, name: row.name, phone: row.phone, officeName: row.office_name };
    throw new Error(`getOrCreateInternalLawyer: insert failed and no row found for office ${officeId}`);
  }
}

/**
 * Guard for API routes that require a signed-in lawyer. Mirrors
 * admin-auth.ts's requireAdmin().
 *
 * Checks the trusted-service header first: env.internalServiceKey is unset
 * by default (this app is fully usable standalone with no caller ever able
 * to present it), and the comparison is constant-time either way. A caller
 * that passes this check skips only the *individual-lawyer* cookie gate —
 * every check that runs after requireLawyer() returns (rate limit, cost
 * caps, guard.ts, self-verify.ts) still runs exactly as it does for a
 * cookie-authenticated lawyer, keyed on the synthetic per-office identity
 * below instead of a cookie-holder's.
 */
export async function requireLawyer(): Promise<{ response: Response | null; lawyer: Lawyer | null }> {
  const configuredKey = env.internalServiceKey;
  if (configuredKey) {
    const hdrs = await headers();
    const presented = hdrs.get(INTERNAL_KEY_HEADER);
    const officeId = hdrs.get(INTERNAL_CALLER_HEADER);
    if (presented && officeId && safeEqual(presented, configuredKey)) {
      return { response: null, lawyer: await getOrCreateInternalLawyer(officeId) };
    }
  }

  const lawyer = await getLawyer();
  if (!lawyer) return { response: Response.json({ error: "الرجاء تسجيل الدخول أولاً." }, { status: 401 }), lawyer: null };
  return { response: null, lawyer };
}

export type RegisterInput = { name: string; phone: string; officeName: string };
export type RegisterResult = { ok: true; lawyer: Lawyer } | { ok: false; error: string };

/** Creates a new lawyer row and signs them in. Fails loudly on a name collision — see normalizeLawyerName. */
export async function registerLawyer(input: RegisterInput): Promise<RegisterResult> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const officeName = input.officeName.trim();
  if (name.length < 2) return { ok: false, error: "الاسم قصير جداً." };
  if (phone.length < 7) return { ok: false, error: "رقم الهاتف غير صالح." };

  const nameKey = normalizeLawyerName(name);
  const existing = await queryOne<{ id: number }>(`SELECT id FROM users WHERE name_key = $1`, [nameKey]);
  if (existing) {
    return { ok: false, error: "هذا الاسم مسجّل مسبقاً. إذا كان الحساب لك، استخدم تسجيل الدخول بدلاً من إنشاء حساب جديد." };
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO users (name, name_key, phone, office_name, role)
     VALUES ($1, $2, $3, $4, 'lawyer')
     RETURNING id`,
    [name, nameKey, phone, officeName || null]
  );
  const lawyer: Lawyer = { id: row!.id, name, phone, officeName: officeName || null };
  await setLawyerCookie(lawyer.id);
  return { ok: true, lawyer };
}

export type LoginResult = { ok: true; lawyer: Lawyer } | { ok: false; error: string };

/** Looks a lawyer up by name only (the returning-visit flow) and signs them in if found. */
export async function loginLawyer(name: string): Promise<LoginResult> {
  const nameKey = normalizeLawyerName(name);
  const row = await queryOne<{ id: number; name: string; phone: string | null; office_name: string | null }>(
    `SELECT id, name, phone, office_name FROM users WHERE name_key = $1 AND role = 'lawyer'`,
    [nameKey]
  );
  if (!row) {
    return { ok: false, error: "لا يوجد حساب بهذا الاسم. إذا كانت زيارتك الأولى، أنشئ حساباً جديداً." };
  }
  await query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [row.id]);
  const lawyer: Lawyer = { id: row.id, name: row.name, phone: row.phone, officeName: row.office_name };
  await setLawyerCookie(lawyer.id);
  return { ok: true, lawyer };
}
