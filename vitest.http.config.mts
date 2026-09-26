import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

// HTTP-level tests: real requests over a socket to the real production server
// (`node server.js` from the assembled .next/standalone bundle, NODE_ENV=
// production), so every request goes client -> proxy.ts -> Next.js -> route
// -> MySQL, exactly like production minus nginx. Unlike the integration
// suite, nothing here calls a route handler directly.
//
// Prerequisites: `npm run build`, and a MySQL the tests may create a
// throwaway database on (HTTP_TEST_DATABASE_URL, default
// mysql://root@localhost:3307/dostoori_http_test — it is DROPPED and
// re-migrated on every run). Set HTTP_TEST_BASE_URL to run the same tests
// against an already-running deployment (e.g. through nginx) instead.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/__http__/**/*.http.test.ts'],
    globalSetup: ['./src/__http__/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
