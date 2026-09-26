// Staging integration (Phase 2, step 47): the REAL Dastoori production bundle
// talking to the REAL ailegal_hussein engine over HTTP — signed assertions,
// the engine's retrieval/grounding/validation, Dastoori's validation, quota
// and conversation storage, and a real browser on top.
//
// The engine runs with its deterministic offline providers and the synthetic
// fixture corpus (no API keys, no real client data — spec step 48).
//
// Prerequisites (local; see PHASE2_REPORT.md):
//   • Dastoori: `npm run build`; a MySQL for a throwaway database
//     (STAGING_DATABASE_URL, default mysql://root@127.0.0.1:3306/dostoori_staging_test — DROPPED and re-migrated).
//   • Engine: checked out at ENGINE_DIR (default ../ailegal_hussein), `npm ci`
//     and `npx next build` done; a Postgres+pgvector database
//     (ENGINE_DATABASE_URL, default postgres://postgres:postgres@localhost:5432/ailegal_test).
import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    engineUrl: string
    engineDatabaseUrl: string
    dastooriDatabaseUrl: string
    enginePid: number
  }
}

const ROOT = resolve(__dirname, '../..')
const ENGINE_DIR = resolve(ROOT, process.env.ENGINE_DIR ?? '../ailegal_hussein')

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

async function waitFor(url: string, proc: ChildProcess, ok: (status: number) => boolean) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`${url}: process exited (${proc.exitCode})`)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (ok(res.status)) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} never became ready`)
}

export default async function setup(project: TestProject) {
  const key = `staging-${randomBytes(24).toString('hex')}`
  const engineDb = process.env.ENGINE_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ailegal_test'
  const dastooriDb = process.env.STAGING_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/dostoori_staging_test'
  if (!/test/i.test(new URL(dastooriDb).pathname)) throw new Error('STAGING_DATABASE_URL must name a *test* database (it is dropped)')
  if (!existsSync(join(ENGINE_DIR, '.next/BUILD_ID'))) throw new Error(`engine not built at ${ENGINE_DIR} — run \`npx next build\` there`)
  if (!existsSync(join(ROOT, '.next/standalone/server.js'))) throw new Error('Dastoori not built — run `npm run build`')
  mkdirSync(join(ROOT, 'test-results'), { recursive: true })

  // ---- engine: schema + synthetic corpus, then `next start`
  const engineEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    DATABASE_URL: engineDb,
    CHAT_PROVIDER: 'test',
    EMBEDDING_PROVIDER: 'test',
    ALLOW_TEST_PROVIDERS: 'true',
    ALLOW_SYNTHETIC_CORPUS: 'true',
    QUERY_LLM_FALLBACK: 'false',
    INTERNAL_SERVICE_KEY: key,
    LAWYER_SESSION_SECRET: 'staging-lawyer-secret',
    IP_HASH_SALT: 'staging-salt',
    ADMIN_PASSWORD: 'staging-admin',
    NEXT_TELEMETRY_DISABLED: '1',
  }
  const tsx = join(ENGINE_DIR, 'node_modules/tsx/dist/cli.mjs')
  execFileSync(process.execPath, [tsx, 'scripts/migrate.ts'], { cwd: ENGINE_DIR, env: engineEnv, stdio: 'pipe' })
  execFileSync(process.execPath, [tsx, '--tsconfig', 'scripts/tsconfig.verify.json', 'scripts/load-eval-fixtures.ts'], { cwd: ENGINE_DIR, env: { ...engineEnv, NODE_ENV: 'test' as const }, stdio: 'pipe' })

  const enginePort = await freePort()
  const engineUrl = `http://127.0.0.1:${enginePort}`
  const engineLog = createWriteStream(join(ROOT, 'test-results/staging-engine.log'))
  const engine = spawn(process.execPath, [join(ENGINE_DIR, 'node_modules/next/dist/bin/next'), 'start', '-p', String(enginePort), '-H', '127.0.0.1'], {
    cwd: ENGINE_DIR,
    env: engineEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  engine.stdout!.pipe(engineLog)
  engine.stderr!.pipe(engineLog)
  await waitFor(`${engineUrl}/api/usage`, engine, (s) => s === 401)

  // ---- Dastoori: fresh database, standalone bundle outside the repo
  const prismaCli = join(ROOT, 'node_modules/prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: dastooriDb },
    stdio: 'pipe',
  })
  const runDir = mkdtempSync(join(tmpdir(), 'dostoori-staging-'))
  execFileSync(process.execPath, [join(ROOT, 'scripts/assemble-standalone.mjs'), runDir], { cwd: ROOT, stdio: 'pipe' })
  mkdirSync(join(runDir, 'storage', 'case-documents'), { recursive: true })
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const appLog = createWriteStream(join(ROOT, 'test-results/staging-dastoori.log'))
  const app = spawn(process.execPath, ['server.js'], {
    cwd: runDir,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: dastooriDb,
      JWT_SECRET: 'staging-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      TWO_FACTOR_ENCRYPTION_KEY: 'staging-2fa-key-0123456789-abcdefghijklmnopqrstuvwxyz01',
      APP_URL: baseUrl,
      PLATFORM_ADMIN_EMAILS: 'platform-admin@dostoori.test',
      TRUST_PROXY: '1',
      APP_VERSION: 'staging-test',
      NEXT_TELEMETRY_DISABLED: '1',
      AI_LEGAL_SERVICE_URL: engineUrl,
      AI_LEGAL_SERVICE_KEY: key,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout!.pipe(appLog)
  app.stderr!.pipe(appLog)
  await waitFor(`${baseUrl}/api/health`, app, (s) => s === 200)

  project.provide('baseUrl', baseUrl)
  project.provide('engineUrl', engineUrl)
  project.provide('engineDatabaseUrl', engineDb)
  project.provide('dastooriDatabaseUrl', dastooriDb)
  project.provide('enginePid', engine.pid!)

  return async () => {
    for (const p of [app, engine]) {
      if (p.exitCode === null) {
        p.kill('SIGTERM')
        await new Promise((r) => (p.exitCode !== null ? r(null) : p.once('exit', r)))
      }
    }
    engineLog.end()
    appLog.end()
    rmSync(runDir, { recursive: true, force: true })
  }
}
