// Authentication, session revocation, CSRF, input handling and tenant
// isolation over real HTTP — cookies as the browser carries them, bodies as
// the network delivers them, errors as the server renders them.
import { beforeAll, describe, expect, it } from 'vitest'
import { http, newIp, PASSWORD, sessionCookie, signup, type Actor } from './client'

let officeA: Actor
let officeB: Actor
let clientA: { id: string }
let caseA: { id: string }

beforeAll(async () => {
  officeA = await signup()
  officeB = await signup()
  const c = await http('/api/clients', { actor: officeA, json: { name: 'HTTP Client A', phone: '0790000000' } })
  expect(c.status).toBe(201)
  clientA = await c.json()
  const k = await http('/api/cases', { actor: officeA, json: { number: 'HTTP-1', title: 'HTTP matter', type: 'مدني', clientId: clientA.id } })
  expect(k.status).toBe(201)
  caseA = await k.json()
})

describe('session cookie', () => {
  it('is HttpOnly + SameSite=Lax, and Secure when the request came over HTTPS', async () => {
    const plain = await http('/api/auth/login', { json: { email: officeA.email, password: PASSWORD } })
    expect(plain.status).toBe(200)
    const cookie = plain.headers.get('set-cookie')!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)

    const tls = await http('/api/auth/login', { json: { email: officeA.email, password: PASSWORD }, headers: { 'X-Forwarded-Proto': 'https' } })
    expect(tls.headers.get('set-cookie')).toMatch(/;\s*Secure/i)
  })

  it('logout revokes the session on the server: a captured cookie is dead afterwards', async () => {
    const login = await http('/api/auth/login', { json: { email: officeA.email, password: PASSWORD } })
    const captured = sessionCookie(login)
    expect((await http('/api/auth/me', { cookie: captured })).status).toBe(200)
    expect((await http('/api/auth/logout', { method: 'POST', cookie: captured })).status).toBe(200)
    expect((await http('/api/auth/me', { cookie: captured })).status).toBe(401)
    expect((await http('/api/cases', { cookie: captured })).status).toBe(401)
    // Logout revokes every session of that user (documented) — re-login for the rest of the file.
    const again = await http('/api/auth/login', { json: { email: officeA.email, password: PASSWORD } })
    officeA = { ...officeA, cookie: sessionCookie(again) }
  })

  it('a forged or tampered token is rejected', async () => {
    const [head, payload] = officeA.cookie.replace('ds_token=', '').split('.')
    for (const cookie of ['ds_token=garbage', `ds_token=${head}.${payload}.AAAA`, `ds_token=${head}.${payload}.`]) {
      expect((await http('/api/auth/me', { cookie })).status).toBe(401)
    }
  })
})

describe('platform admin cannot be obtained by signing up with an allow-listed email', () => {
  it('the account is created as an ordinary office manager and the admin API refuses it', async () => {
    const admin = await signup({ email: 'platform-admin@dostoori.test' })
    const me = await (await http('/api/auth/me', { actor: admin })).json()
    expect(me.user?.isPlatformAdmin ?? me.isPlatformAdmin).toBe(false)
    expect((await http('/api/admin/overview', { actor: admin })).status).toBe(403)
    // …including the state-changing admin actions, aimed at another office.
    expect((await http(`/api/admin/offices/${officeB.officeId}/suspend`, { method: 'POST', actor: admin, json: {} })).status).toBe(403)
    expect((await http(`/api/admin/offices/${officeB.officeId}/extend-trial`, { method: 'POST', actor: admin, json: { days: 30 } })).status).toBe(403)
    expect((await http('/api/cases', { actor: officeB })).status).toBe(200) // B untouched
  })
})

describe('CSRF: cross-site writes are refused', () => {
  it('a foreign Origin gets 403 and nothing is written', async () => {
    const res = await http('/api/clients', {
      actor: officeA, json: { name: 'CSRF client' }, headers: { Origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    const list = await (await http('/api/clients?q=CSRF', { actor: officeA })).json()
    expect(list).toEqual([])
  })

  it('Sec-Fetch-Site: cross-site gets 403 even without an Origin', async () => {
    const res = await http('/api/clients', {
      actor: officeA, json: { name: 'CSRF client 2' }, headers: { Origin: '', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(res.status).toBe(403)
  })
})

describe('bad input is a 4xx with a message, never a 500', () => {
  it('malformed JSON', async () => {
    const res = await http('/api/clients', {
      actor: officeA, body: '{"name": "unterminated', headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTruthy()
  })

  it('over-length fields are rejected before they reach the database', async () => {
    const res = await http('/api/clients', { actor: officeA, json: { name: 'x'.repeat(192) } })
    expect(res.status).toBe(400)
    const kase = await http('/api/cases', { actor: officeA, json: { number: 'N', title: 'T', type: 'مدني', clientId: clientA.id, notes: 'x'.repeat(10_001) } })
    expect(kase.status).toBe(400)
  })

  it('a non-existent id is a 404, not an error page', async () => {
    const res = await http('/api/cases/does-not-exist', { actor: officeA })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('tenant isolation over HTTP', () => {
  it('office B cannot read, list, change or delete office A\'s case or client', async () => {
    expect((await http(`/api/cases/${caseA.id}`, { actor: officeB })).status).toBe(404)
    expect((await http(`/api/cases/${caseA.id}`, { method: 'PATCH', actor: officeB, json: { title: 'pwned' } })).status).toBe(404)
    expect((await http(`/api/cases/${caseA.id}`, { method: 'DELETE', actor: officeB })).status).toBe(404)
    expect((await http(`/api/clients/${clientA.id}`, { actor: officeB })).status).toBe(404)
    expect((await http(`/api/clients/${clientA.id}`, { method: 'DELETE', actor: officeB })).status).toBe(404)

    const listB = await (await http('/api/cases', { actor: officeB })).json()
    expect(listB.map((c: { id: string }) => c.id)).not.toContain(caseA.id)

    // And A's data is intact.
    const still = await (await http(`/api/cases/${caseA.id}`, { actor: officeA })).json()
    expect(still.title).toBe('HTTP matter')
  })

  it('office B cannot attach its records to office A\'s client (cross-entity reference)', async () => {
    const res = await http('/api/cases', { actor: officeB, json: { number: 'X-1', title: 'hijack', type: 'مدني', clientId: clientA.id } })
    expect(res.status).toBe(400)
    const inv = await http('/api/invoices', { actor: officeB, json: { number: 'X-INV', amount: '10', clientId: clientA.id } })
    expect([400, 404]).toContain(inv.status)
  })

  it('office-scoped search does not leak across offices', async () => {
    const res = await http(`/api/search?q=${encodeURIComponent('HTTP matter')}`, { actor: officeB })
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).not.toContain(caseA.id)
  })
})

describe('rate limiting keys on the proxy-supplied client address', () => {
  it('signup: the 6th attempt from one address within the window is 429, a different address is not affected', async () => {
    const ip = newIp()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await http('/api/auth/signup', { ip, json: { name: 'x', email: 'not-an-email', password: 'short' } })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true)
    expect(statuses[5]).toBe(429)
    const other = await http('/api/auth/signup', { ip: newIp(), json: { name: 'x', email: 'not-an-email', password: 'short' } })
    expect(other.status).toBe(400)
  })
})
