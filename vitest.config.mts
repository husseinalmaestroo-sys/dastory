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
    // config (vitest.integration.config.mts, `npm run test:integration`)
    // — excluded here so `npm test` stays fast and needs no live DB.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
})
