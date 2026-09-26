import { defineConfig, devices } from '@playwright/test'

// Browser E2E smoke test of the core office workflow against the production
// server (standalone server.js, NODE_ENV=production) on a freshly migrated
// throwaway database — see e2e/server.mjs. AI is not configured (Phase 2)
// and no payment path is touched.
//
//   npm run build && npm run test:e2e
//
// E2E_DATABASE_URL (default mysql://root@localhost:3307/dostoori_e2e_test) is
// DROPPED and re-migrated on every run; its name must contain "test".
const PORT = Number(process.env.E2E_PORT || 3210)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e',
  use: {
    baseURL,
    locale: 'ar-JO',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `${baseURL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
