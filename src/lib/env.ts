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

// Fail closed at import time — regardless of NODE_ENV — for every secret the
// app cannot safely run without. Any module that needs one of these should
// import the constant from here rather than reading process.env directly.
export const JWT_SECRET = validateStrongSecret('JWT_SECRET', process.env.JWT_SECRET)
export const TWO_FACTOR_ENCRYPTION_KEY = validateStrongSecret('TWO_FACTOR_ENCRYPTION_KEY', process.env.TWO_FACTOR_ENCRYPTION_KEY)
export const DATABASE_URL = requireEnv('DATABASE_URL')
