import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const ADMIN_COOKIE = "als_admin";
const TTL_MS = 1000 * 60 * 60 * 12;

/**
 * Signed-cookie admin auth. One shared password, no user table — deliberate
 * for an MVP with a single operator, and the honest limit of it: there is no
 * per-admin audit trail and rotating the password logs everyone out. Move to
 * real accounts before a second person gets the password.
 */
function sign(payload: string): string {
  return createHmac("sha256", env.adminPassword).update(payload).digest("hex");
}

/** Compares in constant time — `===` on a secret leaks it via timing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function issueToken(): string {
  const expires = Date.now() + TTL_MS;
  return `${expires}.${sign(String(expires))}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expiresRaw, sig] = token.split(".");
  if (!expiresRaw || !sig) return false;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  return safeEqual(sig, sign(expiresRaw));
}

export function checkPassword(input: string): boolean {
  return safeEqual(sign(input), sign(env.adminPassword));
}

export async function setAdminCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_MS / 1000,
    path: "/",
  });
}

export async function clearAdminCookie(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(ADMIN_COOKIE)?.value);
}

/** Guard for admin route handlers. Returns a 401 Response, or null if allowed. */
export async function requireAdmin(): Promise<Response | null> {
  if (await isAdmin()) return null;
  return Response.json({ error: "غير مصرح." }, { status: 401 });
}
