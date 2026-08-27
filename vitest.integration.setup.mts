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
