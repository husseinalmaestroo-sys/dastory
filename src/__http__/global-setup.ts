// Starts the production server for the HTTP-level suite (see
// vitest.http.config.mts): a freshly migrated throwaway database, the
// standalone bundle assembled exactly as the Docker image ships it, and
// `node server.js` with NODE_ENV=production.
import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
  }
}

const ROOT = resolve(__dirname, '../..')
const BUILT = join(ROOT, '.next/standalone')
const LOG_FILE = join(ROOT, 'test-results/http-server.log')

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => res(port))
    })
  })
}

async function waitForHealth(baseUrl: string, server: ChildProcess) {
  const deadline = Date.now() + 90_000
  let last = ''
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      last = `${res.status} ${await res.text()}`
      if (res.ok) return
    } catch (err) {
      last = String(err)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').slice(-4000) : ''
  throw new Error(`server never became healthy (last: ${last})\n--- server log ---\n${log}`)
}

export default async function setup(project: TestProject) {
  const external = process.env.HTTP_TEST_BASE_URL
  if (external) {
    project.provide('baseUrl', external.replace(/\/$/, ''))
    return
  }

  const databaseUrl = process.env.HTTP_TEST_DATABASE_URL || 'mysql://root@localhost:3307/dostoori_http_test'
  const dbName = new URL(databaseUrl).pathname.slice(1)
  if (!/test/i.test(dbName)) {
    throw new Error(`refusing to reset "${dbName}": the HTTP suite drops its database, whose name must contain "test"`)
  }
  if (!existsSync(join(BUILT, 'server.js'))) {
    throw new Error('.next/standalone/server.js not found — run `npm run build` first')
  }

  // Fresh schema from the committed migrations — the same `migrate deploy`
  // path production uses, starting from an empty database.
  const prismaEnv = { ...process.env, DATABASE_URL: databaseUrl }
  const prismaCli = join(ROOT, 'node_modules/prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: ROOT, env: prismaEnv, stdio: 'pipe' })

  // Assembled into a directory OUTSIDE the repo, like /app in the image: a
  // package missing from the bundle must fail here, not be silently
  // resolved from the repo's node_modules by Node's parent-dir lookup.
  const runDir = mkdtempSync(join(tmpdir(), 'dostoori-http-'))
  execFileSync(process.execPath, [join(ROOT, 'scripts/assemble-standalone.mjs'), runDir], { cwd: ROOT, stdio: 'pipe' })
  mkdirSync(join(runDir, 'storage', 'case-documents'), { recursive: true })

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  mkdirSync(join(ROOT, 'test-results'), { recursive: true })
  const log = createWriteStream(LOG_FILE)

  // A clean, explicit environment — nothing inherited from a developer's .env.
  const server = spawn(process.execPath, ['server.js'], {
    cwd: runDir,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'http-test-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      TWO_FACTOR_ENCRYPTION_KEY: 'http-test-2fa-key-0123456789-abcdefghijklmnopqrstuvwxyz0',
      APP_URL: baseUrl,
      PLATFORM_ADMIN_EMAILS: 'platform-admin@dostoori.test',
      // Models the production topology (nginx in front sets X-Real-IP), and
      // lets each test use its own client address for rate-limit buckets.
      TRUST_PROXY: '1',
      APP_VERSION: 'http-test',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout!.pipe(log)
  server.stderr!.pipe(log)

  await waitForHealth(baseUrl, server)
  project.provide('baseUrl', baseUrl)

  return async () => {
    server.kill('SIGTERM')
    await new Promise((r) => (server.exitCode !== null ? r(null) : server.once('exit', r)))
    log.end()
    rmSync(runDir, { recursive: true, force: true })
  }
}
