import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

// Staging integration (Phase 2): the real Dastoori production bundle talking
// to the real ailegal_hussein engine (offline test providers, synthetic
// corpus), plus a real browser. Local/operator run — prerequisites in
// src/__staging__/global-setup.ts. Not part of `npm test` or the default CI.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/__staging__/**/*.staging.test.ts'],
    globalSetup: ['./src/__staging__/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
})
