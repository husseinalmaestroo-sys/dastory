// Response headers, health and routing, as served by the production server
// (proxy.ts sets the security headers; these can't be seen by calling route
// handlers directly).
import { describe, expect, it } from 'vitest'
import { behindProxy, http } from './client'

describe('security headers (proxy.ts) on real responses', () => {
  it('pages carry a nonce-based CSP and the hardening headers; no X-Powered-By', async () => {
    const res = await http('/')
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
    // Production build: no eval, no inline scripts.
    expect(csp).not.toContain('unsafe-eval')
    expect(csp.split(';').find((d) => d.trim().startsWith('script-src'))).not.toContain('unsafe-inline')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('permissions-policy')).toContain('camera=()')
    expect(res.headers.get('x-powered-by')).toBeNull()
    // The nonce in the header is the one actually used on the page's scripts.
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]
    expect(await res.text()).toContain(`nonce="${nonce}"`)
  })

  it('API responses carry them too', async () => {
    const res = await http('/api/auth/me')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it.skipIf(behindProxy)('HSTS is sent when the request arrived over HTTPS (TLS terminated at the proxy)', async () => {
    const res = await http('/', { headers: { 'X-Forwarded-Proto': 'https' } })
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000')
  })
})

describe('health endpoint', () => {
  it('reports real checks, a version, no configuration details, and is never cached', async () => {
    const res = await http('/api/health')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual({ database: true, storage: true, ocr: true })
    expect(typeof body.version).toBe('string')
    expect(JSON.stringify(body)).not.toMatch(/mysql:|password|secret|smtp|stripe/i)
  })
})

describe('routing and access', () => {
  it('dashboard pages redirect anonymous visitors to /login (server-side, before any data loads)', async () => {
    for (const path of ['/dashboard', '/dashboard/cases', '/dashboard/invoices']) {
      const res = await http(path)
      expect([302, 303, 307, 308], path).toContain(res.status)
      expect(res.headers.get('location'), path).toMatch(/\/login$/)
    }
  })

  it('private APIs answer 401 JSON to anonymous callers', async () => {
    for (const path of ['/api/cases', '/api/clients', '/api/documents', '/api/invoices', '/api/admin/overview']) {
      const res = await http(path)
      expect(res.status, path).toBe(401)
      expect(res.headers.get('content-type'), path).toContain('application/json')
    }
  })

  it('robots.txt keeps crawlers out of private areas', async () => {
    const res = await http('/robots.txt')
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const path of ['/dashboard', '/admin', '/citizen', '/api/']) expect(text).toContain(`Disallow: ${path}`)
  })
})
