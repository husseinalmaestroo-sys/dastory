import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

// Separate from vitest.config.mts on purpose: these tests hit a real MySQL
// database (see vitest.integration.setup.mts) and are slower/order-
// sensitive, so they're not part of the fast `npm test` unit suite and
// must run sequentially, not in parallel workers, to avoid interleaved
// writes to shared tables.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./vitest.integration.setup.mts'],
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
