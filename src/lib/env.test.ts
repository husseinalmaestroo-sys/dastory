import { describe, expect, it } from 'vitest'
import { EnvValidationError, requireEnv, validateStrongSecret } from './env'
import { parsePlatformAdminEmails, validateAppUrl } from './env'

// These tests pin down the fail-closed behavior of secret validation. They
// must never depend on NODE_ENV — that was exactly the gap that let
// JWT_SECRET fall back to a hardcoded dev value in production before.

describe('validateStrongSecret', () => {
  it('rejects a missing value', () => {
    expect(() => validateStrongSecret('X_SECRET', undefined)).toThrow(EnvValidationError)
  })

  it('rejects an empty/whitespace-only value', () => {
    expect(() => validateStrongSecret('X_SECRET', '   ')).toThrow(EnvValidationError)
  })

  it('rejects a value shorter than 32 characters', () => {
    expect(() => validateStrongSecret('X_SECRET', 'short-secret')).toThrow(/at least 32 characters/)
  })

  it('rejects the historical hardcoded dev fallback', () => {
    // Also short (29 chars), so this is caught by the length check — the
    // important invariant is simply that this exact value can never pass.
    expect(() => validateStrongSecret('X_SECRET', 'dostoori-dev-secret-change-me')).toThrow(EnvValidationError)
  })


  it('rejects the .env.example placeholder even though it is 32+ characters', () => {
    const placeholder = 'change-this-to-a-random-secret-at-least-32-chars'
    expect(placeholder.length).toBeGreaterThanOrEqual(32)
    expect(() => validateStrongSecret('X_SECRET', placeholder)).toThrow(/known example\/default/)
  })

  it('rejects known defaults regardless of case', () => {
    const placeholder = 'CHANGE-THIS-TO-A-RANDOM-SECRET-AT-LEAST-32-CHARS'
    expect(() => validateStrongSecret('X_SECRET', placeholder)).toThrow(/known example\/default/)
  })

  it('accepts a sufficiently long, non-default random secret', () => {
    const strong = 'f3a1c9d2e8b7460591b2c3d4e5f6a7b8c9d0e1f2'
    expect(validateStrongSecret('X_SECRET', strong)).toBe(strong)
  })

  it('trims surrounding whitespace on an otherwise valid secret', () => {
    const strong = 'f3a1c9d2e8b7460591b2c3d4e5f6a7b8c9d0e1f2'
    expect(validateStrongSecret('X_SECRET', `  ${strong}  `)).toBe(strong)
  })

  it('never includes the offending value in the thrown error message', () => {
    const secretValue = 'dostoori-dev-secret-change-me'
    try {
      validateStrongSecret('X_SECRET', secretValue)
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).not.toContain(secretValue)
    }
  })
})

describe('requireEnv', () => {
  it('throws when the variable is unset', () => {
    expect(() => requireEnv('DOES_NOT_EXIST_ENV_VAR')).toThrow(EnvValidationError)
  })

  it('returns the trimmed value when set', () => {
    process.env.SOME_TEST_VAR = '  value  '
    expect(requireEnv('SOME_TEST_VAR')).toBe('value')
    delete process.env.SOME_TEST_VAR
  })
})


describe('validateAppUrl — the only origin allowed in emailed links', () => {
  it('is required (no fallback to the request Host)', () => {
    expect(() => validateAppUrl(undefined)).toThrow(/APP_URL is required/)
    expect(() => validateAppUrl('  ')).toThrow(EnvValidationError)
  })
  it('accepts a bare https origin and normalizes it', () => {
    expect(validateAppUrl('https://app.example.com')).toBe('https://app.example.com')
    expect(validateAppUrl('https://app.example.com/')).toBe('https://app.example.com')
    expect(validateAppUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('rejects non-http schemes, paths, queries and credentials', () => {
    for (const bad of ['ftp://x.com', 'javascript:alert(1)', 'https://x.com/app', 'https://x.com?a=1', 'https://u:p@x.com', 'not a url']) {
      expect(() => validateAppUrl(bad), bad).toThrow(EnvValidationError)
    }
  })
})

describe('parsePlatformAdminEmails — no default, fail closed', () => {
  it('is required: an unset value no longer falls back to a fixed address', () => {
    expect(() => parsePlatformAdminEmails(undefined)).toThrow(/PLATFORM_ADMIN_EMAILS is required/)
    expect(() => parsePlatformAdminEmails(' , ')).toThrow(EnvValidationError)
  })
  it('parses and lower-cases a comma-separated list', () => {
    expect([...parsePlatformAdminEmails(' Ops@Example.com , second@example.com ')]).toEqual(['ops@example.com', 'second@example.com'])
  })
  it('rejects a malformed entry', () => {
    expect(() => parsePlatformAdminEmails('ops@example.com,not-an-email')).toThrow(/invalid email/)
  })
})
