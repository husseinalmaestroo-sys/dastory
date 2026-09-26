import { createHash, createHmac, randomBytes } from 'crypto'

/**
 * Signs one request to ailegal_hussein (Phase 2 AI boundary).
 *
 * Replaces the old scheme — a shared key sent in `X-Internal-Service-Key`
 * plus a free-form `X-Dostoori-Office-Id` — under which anything able to add
 * a header could name any office, and a captured request could be replayed
 * forever. The assertion is an HMAC-SHA256-signed token carrying:
 *
 *   off / usr — the office and user from Dostoori's own server-side session,
 *   m / p     — the HTTP method and path it is valid for,
 *   bh        — SHA-256 of the exact request body,
 *   iat / exp — a lifetime of TTL_S seconds,
 *   jti       — a random id the engine accepts once (replay protection).
 *
 * The key (AI_LEGAL_SERVICE_KEY) is never sent. Byte-compatible with
 * ailegal_hussein/src/lib/service-auth.ts (verifier + reference minter).
 */

export const ASSERTION_HEADER = 'X-Dostoori-Assertion'
const TTL_S = 60

const b64url = (buf: Buffer) => buf.toString('base64url')

export function bodyHash(body: string | Uint8Array): string {
  return b64url(createHash('sha256').update(body).digest())
}

export function mintServiceAssertion(
  key: string,
  claims: { officeId: string; userId: string; method: string; path: string; body: string | Uint8Array; now?: number }
): string {
  const iat = Math.floor((claims.now ?? Date.now()) / 1000)
  const payload = {
    v: 1,
    iss: 'dostoori',
    aud: 'ailegal_hussein',
    off: claims.officeId,
    usr: claims.userId,
    jti: b64url(randomBytes(16)),
    iat,
    exp: iat + TTL_S,
    m: claims.method.toUpperCase(),
    p: claims.path,
    bh: bodyHash(claims.body),
  }
  const payloadPart = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = b64url(createHmac('sha256', key).update(`v1.${payloadPart}`).digest())
  return `v1.${payloadPart}.${sig}`
}
