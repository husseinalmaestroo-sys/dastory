// Ambient env vars for the test process only. vitest does not load .env files,
// so modules that eagerly validate required secrets (src/lib/env.ts) need safe,
// valid-shaped values here or every test that transitively imports them would
// throw on import. These are never used to talk to a real database or sign
// tokens anyone relies on.
process.env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789-abcdefghijklmnop'
process.env.TWO_FACTOR_ENCRYPTION_KEY ??= 'test-only-2fa-key-0123456789-abcdefghijklmnopqrstuv'
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test'
process.env.APP_URL ??= 'https://app.dostoori.test'
process.env.PLATFORM_ADMIN_EMAILS ??= 'platform-admin@dostoori.test'
// Tests model the production topology: behind our own reverse proxy.
process.env.TRUST_PROXY ??= '1'
