// Playwright webServer for the E2E suite: fresh database from the committed
// migrations, the standalone bundle assembled OUTSIDE the repo (exactly the
// Docker image's layout), then `node server.js` in production mode. Stays in
// the foreground; Playwright stops it when the run ends.
import { execFileSync, spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const port = process.env.E2E_PORT || '3210'
const databaseUrl = process.env.E2E_DATABASE_URL || 'mysql://root@localhost:3307/dostoori_e2e_test'
const dbName = new URL(databaseUrl).pathname.slice(1)
if (!/test/i.test(dbName)) {
  console.error(`[e2e] refusing to reset "${dbName}": the E2E database is dropped each run and its name must contain "test"`)
  process.exit(1)
}
if (!existsSync(join(root, '.next/standalone/server.js'))) {
  console.error('[e2e] .next/standalone/server.js not found — run `npm run build` first')
  process.exit(1)
}

execFileSync(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
  cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
})

const runDir = mkdtempSync(join(tmpdir(), 'dostoori-e2e-'))
execFileSync(process.execPath, [join(root, 'scripts/assemble-standalone.mjs'), runDir], { cwd: root, stdio: 'inherit' })
mkdirSync(join(runDir, 'storage', 'case-documents'), { recursive: true })

const server = spawn(process.execPath, ['server.js'], {
  cwd: runDir,
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    PORT: port,
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'e2e-test-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz0',
    TWO_FACTOR_ENCRYPTION_KEY: 'e2e-test-2fa-key-0123456789-abcdefghijklmnopqrstuvwxyz01',
    APP_URL: `http://127.0.0.1:${port}`,
    PLATFORM_ADMIN_EMAILS: 'platform-admin@dostoori.test',
    APP_VERSION: 'e2e',
    NEXT_TELEMETRY_DISABLED: '1',
  },
})

const stop = () => server.kill('SIGTERM')
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', (code) => {
  rmSync(runDir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
