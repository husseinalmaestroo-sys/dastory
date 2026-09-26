// Centralized environment validation. Import this module (directly or
// transitively) wherever a secret is needed instead of reading
// `process.env` inline — that keeps validation consistent and in one place.
//
// Validation here NEVER depends on NODE_ENV. A misconfigured or missing
// NODE_ENV must not be able to downgrade a required secret's validation from
// "fail closed" to "silently accept a weak default" — that gap is exactly
// what let JWT_SECRET fall back to a hardcoded dev value in earlier builds.

const MIN_SECRET_LENGTH = 32

// Values known to have shipped as example/placeholder secrets in this repo's
// own history (.env.example, prior hardcoded fallbacks) or that are common
// generic placeholders. Comparison is case-insensitive.
const KNOWN_WEAK_SECRETS = new Set(
  [
    'dostoori-dev-secret-change-me',
    'change-this-to-a-random-secret-at-least-32-chars',
    'change-this-to-a-different-random-secret-32-chars-min',
    'secret',
    'changeme',
    'change-me',
    'password',
    'your-secret-key',
    'development-secret',
    'test-secret',
    'default-secret',
    'insecure-secret',
    'super-secret-key',
    'my-secret-key',
    'replace-me',
    'replace-this-with-a-real-secret',
  ].map((s) => s.toLowerCase())
)

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvValidationError'
  }
}

/**
 * Validates a secret meant for cryptographic use (JWT signing, encryption
 * keys, etc). Throws EnvValidationError — never logs or echoes the value
 * itself — if the secret is missing, too short, or a known placeholder.
 */
export function validateStrongSecret(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new EnvValidationError(
      `${name} is required but not set. Set it in your environment (a random string of at least ${MIN_SECRET_LENGTH} characters) before starting the app.`
    )
  }

  const trimmed = value.trim()

  if (trimmed.length < MIN_SECRET_LENGTH) {
    throw new EnvValidationError(`${name} must be at least ${MIN_SECRET_LENGTH} characters long.`)
  }

  if (KNOWN_WEAK_SECRETS.has(trimmed.toLowerCase())) {
    throw new EnvValidationError(
      `${name} is set to a known example/default value, which is not safe to run with. Generate a unique random secret and set it in your environment.`
    )
  }

  return trimmed
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new EnvValidationError(`${name} is required but not set. Configure it in your environment before starting the app.`)
  }
  return value.trim()
}

/**
 * The app's public origin (scheme + host [+ port]) — the ONLY base allowed for
 * absolute links in outgoing email (password reset, email verification).
 * Security-sensitive: deriving it from the request's Host header instead let
 * anyone who could send a request with a forged Host make the app email a
 * genuine reset link pointing at their own server. Rejects anything that
 * isn't a bare http(s) origin.
 */
export function validateAppUrl(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new EnvValidationError(
      'APP_URL is required but not set. Set it to the public origin users reach the app on, e.g. APP_URL="https://app.example.com".'
    )
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new EnvValidationError('APP_URL must be an absolute URL such as "https://app.example.com".')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EnvValidationError('APP_URL must use https:// (or http:// for local development).')
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash || url.username || url.password) {
    throw new EnvValidationError('APP_URL must be a bare origin — no path, query, fragment or credentials.')
  }
  return url.origin
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/

/**
 * Platform-admin allow-list. There is NO default: an unset value used to fall
 * back to a fixed address, so whoever self-registered that address first
 * became platform admin. Listing an email here is necessary but not
 * sufficient — the account must also be explicitly provisioned
 * (scripts/platform-admin.mjs), email-verified and 2FA-enabled.
 */
export function parsePlatformAdminEmails(value: string | undefined): ReadonlySet<string> {
  if (!value || !value.trim()) {
    throw new EnvValidationError(
      'PLATFORM_ADMIN_EMAILS is required but not set. List the operator email(s) allowed to hold platform admin, comma-separated.'
    )
  }
  const emails = value.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) throw new EnvValidationError('PLATFORM_ADMIN_EMAILS must contain at least one email.')
  const invalid = emails.filter((e) => !EMAIL_RE.test(e))
  if (invalid.length > 0) throw new EnvValidationError(`PLATFORM_ADMIN_EMAILS contains an invalid email: ${invalid[0]}`)
  return new Set(emails)
}

// Fail closed at import time — regardless of NODE_ENV — for every secret and
// security-relevant setting the app cannot safely run without. Any module
// that needs one of these should import the constant from here rather than
// reading process.env directly.
export const JWT_SECRET = validateStrongSecret('JWT_SECRET', process.env.JWT_SECRET)
export const TWO_FACTOR_ENCRYPTION_KEY = validateStrongSecret('TWO_FACTOR_ENCRYPTION_KEY', process.env.TWO_FACTOR_ENCRYPTION_KEY)
export const DATABASE_URL = requireEnv('DATABASE_URL')
export const APP_ORIGIN = validateAppUrl(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)
export const PLATFORM_ADMIN_EMAILS = parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)
