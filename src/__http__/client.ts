// Tiny HTTP client for the HTTP-level suite: real fetch() over a socket to the
// server started by global-setup.ts. Mutating requests carry the same-origin
// Origin header a browser would send (the CSRF check in api-security.ts
// requires it to match); tests that exercise the check override it.
import { randomBytes, randomUUID } from 'crypto'
import { inject } from 'vitest'

export const baseUrl = inject('baseUrl')

/** A fresh client address per actor, so per-IP rate-limit buckets don't collide across tests (the server runs with TRUST_PROXY=1, as behind nginx). */
export function newIp(): string {
  const [a, b, c] = randomBytes(3)
  return `10.${a}.${b}.${c}`
}

export type Actor = { cookie: string; ip: string; email: string; id: string; officeId: string }

type Opts = {
  method?: string
  actor?: Pick<Actor, 'cookie' | 'ip'>
  cookie?: string
  ip?: string
  json?: unknown
  body?: BodyInit
  headers?: Record<string, string>
  redirect?: RequestRedirect
}

export async function http(path: string, opts: Opts = {}): Promise<Response> {
  const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? 'POST' : 'GET')
  const headers: Record<string, string> = {}
  const cookie = opts.cookie ?? opts.actor?.cookie
  if (cookie) headers.Cookie = cookie
  headers['X-Real-IP'] = opts.ip ?? opts.actor?.ip ?? newIp()
  if (method !== 'GET' && method !== 'HEAD') headers.Origin = baseUrl
  let body = opts.body
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, ...opts.headers },
    body,
    redirect: opts.redirect ?? 'manual',
  })
}

export function sessionCookie(res: Response): string {
  const token = /ds_token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  if (!token) throw new Error(`no session cookie issued (status ${res.status})`)
  return `ds_token=${token}`
}

export const PASSWORD = 'HttpTestPassw0rd!'

/** Signs up a brand-new office manager through the public signup endpoint. */
export async function signup(overrides: { email?: string } = {}): Promise<Actor> {
  const ip = newIp()
  const email = overrides.email ?? `http-${randomUUID().slice(0, 12)}@dostoori.test`
  const res = await http('/api/auth/signup', {
    ip,
    json: { name: 'HTTP Test Manager', officeName: `HTTP Office ${randomUUID().slice(0, 6)}`, email, password: PASSWORD },
  })
  if (res.status !== 200 && res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`)
  const { user } = await res.json()
  return { cookie: sessionCookie(res), ip, email, id: user.id, officeId: user.officeId }
}
