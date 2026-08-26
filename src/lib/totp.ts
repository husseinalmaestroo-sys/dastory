import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const TOTP_STEP_SECONDS = 30
const TOTP_DIGITS = 6

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20)
  let bits = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')

  let secret = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    secret += BASE32_ALPHABET[parseInt(chunk, 2)]
  }
  return secret
}

function decodeBase32(secret: string) {
  const cleaned = secret.replace(/[\s=]/g, '').toUpperCase()
  let bits = ''
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 secret')
    bits += index.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number) {
  const key = decodeBase32(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))

  const digest = crypto.createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

export function generateTotpCode(secret: string, at = Date.now()) {
  return hotp(secret, Math.floor(at / 1000 / TOTP_STEP_SECONDS))
}

export function verifyTotpCode(secret: string, code: unknown, window = 1) {
  if (typeof code !== 'string') return false
  const cleaned = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false

  const now = Date.now()
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotpCode(secret, now + offset * TOTP_STEP_SECONDS * 1000)
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) return true
  }
  return false
}

export function formatTotpSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret
}

export function getTotpUri(email: string, secret: string) {
  const issuer = 'Dostoori'
  const label = `${issuer}:${email}`
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}
