// Points the app's real Prisma client at a dedicated test database, so
// integration tests exercise real Prisma queries, real unique constraints,
// real tenant-scoping where-clauses — not mocks. Must run before any test
// file imports @/lib/prisma, @/lib/env, etc., which is what vitest's
// `setupFiles` guarantees.
//
// Setup required once per machine before running `npm run test:integration`:
//   mysql -e "CREATE DATABASE dostoori_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
//   DATABASE_URL="mysql://root@localhost:3307/dostoori_test" npx prisma migrate deploy
process.env.DATABASE_URL = 'mysql://root@localhost:3307/dostoori_test'
process.env.JWT_SECRET = 'integration-test-jwt-secret-0123456789-abcdefghijklmnop'
process.env.TWO_FACTOR_ENCRYPTION_KEY = 'integration-test-2fa-key-0123456789-abcdefghijklmnopqrstuv'

// Explicitly unset, not just "happen to be absent": Vite loads the real
// .env, so a developer who has added a real key here for their own manual
// testing (see e.g. legal-rag-client.ts) would otherwise silently flip the
// "service not configured -> honest 503" tests below into "service
// configured -> tries a real network call" — a false pass or a confusing
// failure depending on what's listening on the other end, either way not
// what those tests are supposed to exercise. Deleting keeps this file the
// single place that decides "external AI providers are unconfigured in
// integration tests", independent of whatever any one developer's .env has.
delete process.env.ANTHROPIC_API_KEY
delete process.env.AI_LEGAL_SERVICE_URL
delete process.env.AI_LEGAL_SERVICE_KEY
delete process.env.STRIPE_SECRET_KEY
delete process.env.STRIPE_WEBHOOK_SECRET
