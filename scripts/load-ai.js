// k6 load test for the AI path — the one part of the deploy that makes
// real 15–60s upstream calls and sits behind nginx's proxy_read_timeout.
// Proves that under concurrency nothing 502/504s and p95 stays sane.
//
//   k6 run -e BASE=https://app.example.com scripts/load-ai.js
//
// COSTS REAL MONEY: every iteration is a real ailegal_hussein → OpenAI
// call. Defaults are deliberately small. Tune with env vars:
//   -e VUS=3 -e DURATION=5m -e P95_MS=120000
//
// Install k6: https://k6.io/docs/get-started/installation/
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = (__ENV.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '')
const VUS = Number(__ENV.VUS || 3)
const DURATION = __ENV.DURATION || '5m'
const P95_MS = Number(__ENV.P95_MS || 120000)

export const options = {
  scenarios: {
    ai: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '90s' },
  },
  thresholds: {
    // no gateway timeouts / upstream errors under load
    'http_req_failed{name:assistant}': ['rate<0.02'],
    'http_req_duration{name:assistant}': [`p(95)<${P95_MS}`],
    checks: ['rate>0.98'],
  },
}

const QUESTIONS = [
  'ما هي مدة التقادم في الدعوى المدنية بشكل عام؟',
  'ما هي شروط صحة عقد البيع في القانون المدني الأردني؟',
  'هل يجوز فصل الموظف أثناء الإجازة المرضية؟',
  'ما هي إجراءات رفع دعوى إخلاء مأجور؟',
  'ما الفرق بين الفسخ والإنهاء في عقود العمل؟',
]

// One throwaway office; every VU reuses its cookie.
export function setup() {
  const email = `loadtest+${Date.now()}@smoke.invalid`
  const res = http.post(
    `${BASE}/api/auth/signup`,
    JSON.stringify({ name: 'Load Test', officeName: 'Load Office', email, password: 'LoadTest12345' }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (res.status !== 201) throw new Error(`setup signup failed: ${res.status} ${res.body}`)
  const cookie = (res.headers['Set-Cookie'] || '').match(/ds_token=[^;]+/)
  if (!cookie) throw new Error('setup: no ds_token cookie returned')
  return { cookie: cookie[0], email }
}

export default function loadAiIteration(data) {
  const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]
  const res = http.post(`${BASE}/api/ai/assistant`, JSON.stringify({ message: q }), {
    headers: { 'Content-Type': 'application/json', Cookie: data.cookie },
    timeout: '180s',
    tags: { name: 'assistant' },
  })
  check(res, {
    'status 200': (r) => r.status === 200,
    'not a gateway timeout': (r) => r.status !== 502 && r.status !== 504,
    'has an answer': (r) => {
      try { return typeof JSON.parse(r.body).answer === 'string' } catch { return false }
    },
  })
  sleep(1)
}

export function teardown(data) {
  console.log(`load test done — throwaway office ${data.email} left in the DB (prune by the smoke.invalid domain).`)
}
