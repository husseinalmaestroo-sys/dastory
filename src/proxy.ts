import { NextResponse, type NextRequest } from 'next/server'
import { isHttpsRequest } from '@/lib/api-security'

// Inventory behind this policy (see also src/app/layout.tsx, src/components/landing):
// - Scripts: only Next.js's own bundles + its RSC-streaming inline bootstrap
//   scripts, which Next.js nonce-tags automatically when it finds a nonce in
//   the CSP header we set below. No other inline/eval script is used.
// - Styles: Tailwind's compiled stylesheet (served from 'self') PLUS a large
//   number of React inline `style={{...}}` props throughout the app, which
//   render as inline `style="..."` attributes. CSP has no nonce mechanism for
//   style *attributes* (only for <style> elements) — the alternative would be
//   removing every inline style prop app-wide, which is the large frontend
//   refactor explicitly out of scope right now. style-src therefore keeps
//   'unsafe-inline' as a deliberate, scoped exception; script-src does not.
// - Images: same-origin assets plus the data: URI favicon (src/app/layout.tsx)
//   and blob: (canvas-generated signature image before upload).
// - Fonts: Cairo is self-hosted from public/fonts (src/app/fonts.css) — no
//   external font host is ever requested, at build time or at runtime.
// - Frames: YouTube embeds for the admin-configurable hero video
//   (src/components/landing/Hero.tsx, src/app/admin/page.tsx).
// - Connections: same-origin API calls only.
// next dev's webpack HMR runtime evaluates code via eval(), which a strict
// script-src blocks (verified locally: without this, every dev page throws
// "Evaluating a string as JavaScript violates ... script-src"). Production
// bundles (next build / next start) don't use eval-based devtool source
// maps and were verified clean without it. Unlike JWT_SECRET/cookie
// handling, this NODE_ENV check is safe: it's not reading an
// externally-configured deployment value, it's reading the value Next.js's
// own CLI sets deterministically per-command (`next dev` always sets
// 'development', `next start` always sets 'production' — see HOSTINGER_DEPLOY.md
// step 3, which runs `npm start`).
const IS_DEV = process.env.NODE_ENV !== 'production'

function buildCsp(nonce: string, https: boolean) {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_DEV ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-src 'self' https://www.youtube.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ]
  if (https) directives.push('upgrade-insecure-requests')
  return directives.join('; ')
}

// Renamed from `middleware` (Next.js 16 — the `middleware.ts` convention and
// the `middleware` export name are both deprecated in favor of `proxy.ts` /
// `proxy`; see ARCHITECTURE.md "Security headers"). Behavior is unchanged —
// proxy.ts now always runs on the nodejs runtime rather than edge (edge was
// the only, unconfigurable option for the old middleware convention), which
// this file never depended on being edge-specific.
export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const https = isHttpsRequest(req)
  const csp = buildCsp(nonce, https)

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })

  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')

  if (https) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
