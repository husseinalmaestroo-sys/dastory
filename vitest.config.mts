import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.mts'],
    // Integration tests hit a real database and live under their own
    // config (vitest.integration.config.mts, `npm run test:integration`);
    // HTTP-level tests need a built server (vitest.http.config.mts,
    // `npm run test:http`); e2e/ is Playwright (`npm run test:e2e`). All
    // excluded here so `npm test` stays fast and needs no live DB or build.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts', '**/*.http.test.ts', 'e2e/**', '.next/**'],
  },
})
