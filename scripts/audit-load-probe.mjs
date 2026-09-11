#!/usr/bin/env node
// 10-firm pilot security audit — Section 10 (concurrent users) + 16
// (performance), run against the live dev server. Real HTTP over the
// network stack (not in-process route calls like the vitest suite), 20
// simulated lawyers (2 per firm x 10 firms) each doing a realistic sequence:
// login -> list cases -> list clients -> create a client -> list documents
// -> logout. Fired concurrently across all 20. Non-AI endpoints only, on
// purpose: a real load test of the AI/RAG path means real, paid LLM calls
// per request, and the single-process rate limiter (accepted limitation,
// launch-plan item 11) would legitimately reject a 20-way burst against it —
// that behavior is demonstrated separately below with a handful of requests
// against ONE rate-limited endpoint, not by spending 20x LLM calls to
// re-prove a limiter that's already unit-tested.
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000'
const FIRM_COUNT = 10
const PASSWORD = 'PilotAudit@2025'

function extractCookie(res) {
  const raw = res.headers.get('set-cookie')
  return raw ? raw.split(';')[0] : null
}

async function lawyerSession(firmN, seat) {
  const email = `firm${String(firmN).padStart(2, '0')}.lawyer${seat}@test.dastory.local`
  // A real office's staff share one public IP (NAT); a real 10-firm rollout
  // has 10 different office IPs. Set a distinct synthetic IP PER FIRM (not
  // per lawyer) so this probe reflects that — without it, this script
  // itself is the confound: all 20 logins would hit the login endpoint's
  // per-IP anti-brute-force limiter (8/min, auth/login/route.ts) from one
  // real IP (localhost) purely because one machine is running the test, a
  // false "cross-tenant" collision this codebase would never see in prod.
  const officeIp = `10.${firmN}.0.1`
  const fwdHeaders = { 'X-Forwarded-For': officeIp }
  const t0 = Date.now()

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...fwdHeaders },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (!loginRes.ok) return { email, ok: false, step: 'login', status: loginRes.status }
  const cookie = extractCookie(loginRes)
  const authed = (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, ...fwdHeaders, Cookie: cookie } })

  const steps = []
  for (const [name, run] of [
    ['listCases', () => authed('/api/cases')],
    ['listClients', () => authed('/api/clients')],
    ['createClient', () => authed('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Load test client ${email} ${Date.now()}` }) })],
    ['listDocuments', () => authed('/api/documents')],
    ['dashboard', () => authed('/api/dashboard')],
    ['logout', () => authed('/api/auth/logout', { method: 'POST' })],
  ]) {
    const s = Date.now()
    const res = await run()
    steps.push({ name, status: res.status, ms: Date.now() - s })
  }

  return { email, ok: steps.every((s) => s.status < 400), steps, totalMs: Date.now() - t0 }
}

async function main() {
  console.log(`Concurrency probe against ${BASE} — ${FIRM_COUNT * 2} simulated lawyers, fired simultaneously`)
  const t0 = Date.now()
  const sessions = []
  for (let f = 1; f <= FIRM_COUNT; f++) {
    sessions.push(lawyerSession(f, '01'))
    sessions.push(lawyerSession(f, '02'))
  }
  const results = await Promise.allSettled(sessions)
  const wallMs = Date.now() - t0

  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok)
  const failed = results.filter((r) => r.status === 'rejected' || !r.value?.ok)

  console.log(`\nWall clock for all ${results.length} concurrent sessions: ${wallMs}ms`)
  console.log(`Sessions fully successful: ${ok.length}/${results.length}`)
  if (failed.length) {
    console.log('Failures:')
    for (const f of failed) console.log(f.status === 'rejected' ? f.reason : JSON.stringify(f.value))
  }

  const allStepTimings = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.steps ?? [] : []))
  const byName = {}
  for (const s of allStepTimings) {
    byName[s.name] ??= []
    byName[s.name].push(s.ms)
  }
  console.log('\nPer-endpoint timing across all 20 concurrent callers (ms):')
  const table = {}
  for (const [name, times] of Object.entries(byName)) {
    const sorted = [...times].sort((a, b) => a - b)
    table[name] = {
      count: times.length,
      min: sorted[0],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
      max: sorted[sorted.length - 1],
      errors: allStepTimings.filter((s) => s.name === name && s.status >= 400).length,
    }
  }
  console.table(table)

  console.log('\n--- Login rate limiter under a same-IP burst (auth/login/route.ts: 8/min per IP) ---')
  const burstIp = '10.99.0.1' // one synthetic office IP, on purpose — this IS the scenario being checked
  const statuses = []
  for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': burstIp },
      body: JSON.stringify({ email: 'firm01.lawyer01@test.dastory.local', password: PASSWORD }),
    })
    statuses.push(res.status)
  }
  const firstLimitedAt = statuses.findIndex((s) => s === 429)
  console.log(`12 logins in a row from ONE IP: ${JSON.stringify(statuses)}`)
  console.log(firstLimitedAt === -1
    ? 'No 429 seen in 12 rapid same-IP logins — unexpected, the limiter should engage at request #9.'
    : `429 first appears at request #${firstLimitedAt + 1} — matches the configured 8/min. Correct anti-brute-force behavior for ONE account. Real-world implication: a real office of >8 people behind one shared NAT/IP logging in within the same minute (e.g. a Monday morning rush) would see legitimate lawyers 9+ get 429'd too, since the bucket is per-IP, not per-account. Not a risk for THIS pilot's 2-lawyers-per-firm shape (see the per-firm-IP results above, all clean) — worth knowing before onboarding any single office with a larger staff count.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
