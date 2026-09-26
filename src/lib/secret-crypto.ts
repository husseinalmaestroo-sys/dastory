// Authenticated encryption (AES-256-GCM) for secrets we must store at rest,
// currently: TOTP (2FA) secrets. The key is derived from
// TWO_FACTOR_ENCRYPTION_KEY (validated in src/lib/env.ts — required,
// >=32 chars, not a known placeholder) via SHA-256, so operators can set any
// sufficiently long random string without worrying about hex/base64 framing.
//
// Ciphertext is stored as `v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>`. The
// `v1:` prefix lets decryptSecret tell an encrypted value apart from a
// legacy plaintext TOTP secret (base32: A-Z2-7 only, never contains ':') —
// see isLegacyPlaintext, used by the 2FA routes to migrate old rows in
// place the next time they're read, and by prisma/legacy/migrate-2fa-secrets.ts to
// migrate all of them up front.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { TWO_FACTOR_ENCRYPTION_KEY } from '@/lib/env'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const VERSION_PREFIX = 'v1'

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

const encryptionKey = deriveKey(TWO_FACTOR_ENCRYPTION_KEY)

export function isLegacyPlaintext(stored: string): boolean {
  return !stored.startsWith(`${VERSION_PREFIX}:`)
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [VERSION_PREFIX, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/**
 * Decrypts a value produced by encryptSecret. If `stored` predates
 * encryption (a raw legacy plaintext TOTP secret with no `v1:` prefix), it
 * is returned unchanged — callers that want to migrate it forward should
 * check isLegacyPlaintext() themselves and re-save via encryptSecret().
 */
export function decryptSecret(stored: string): string {
  if (isLegacyPlaintext(stored)) return stored

  const parts = stored.split(':')
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted secret')
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Decrypts `stored`, and if it turns out to be a legacy (pre-encryption)
 * plaintext value, persists the encrypted form via `persist` so the row is
 * migrated in place the next time it's touched. DB-agnostic by design (takes
 * a persist callback) so this stays unit-testable without a real database.
 */
export async function resolveAndMigrateSecret(stored: string, persist: (encrypted: string) => Promise<unknown>): Promise<string> {
  const secret = decryptSecret(stored)
  if (isLegacyPlaintext(stored)) {
    await persist(encryptSecret(secret))
  }
  return secret
}
