# دُسْتُورِي — Architecture Reference

> This describes the system as it actually exists in this repository — verified against the code, not aspirational. If you change the architecture, update this file in the same change.

---

## Overview

Dostoori is a single Next.js application — no separate backend service, no microservices. The App Router handles both the UI (React Server + Client Components) and the API (Route Handlers under `src/app/api/`), all talking to one MySQL database through Prisma.

```
                    Browser
                       │
              ┌────────┴────────┐
              │   proxy.ts  │  ← CSP/security headers on every request
              └────────┬────────┘
                       │
         ┌─────────────┴─────────────┐
         │      Next.js App Router    │
         │  ┌───────────┬───────────┐ │
         │  │  Pages /   │  API      │ │
         │  │  Layouts   │  Route    │ │
         │  │ (RSC/RCC)  │  Handlers │ │
         │  └───────────┴───────────┘ │
         └─────────────┬─────────────┘
                       │  Prisma Client
                       ▼
                 MySQL (single DB)
                       │
                       ▼
        Local disk — storage/case-documents/
```

There is no Redis, no queue, no WebSocket server. Search over Dostoori's own data (cases, clients, invoices) is plain MySQL `LIKE` queries (see [Search](#search)) — that part is unchanged. AI is real, not mockups. Every AI feature routes through one backend:

**`ailegal_hussein`** — a separate, standalone RAG service (own Next.js app, own Postgres+pgvector vector database of real Jordanian legislation/case law, own OpenAI key) living alongside this repo at `./ailegal_hussein`, called over an internal HTTP boundary (`src/lib/ai/legal-rag-client.ts`) after Dostoori's own auth/tenant/rate-limit/monthly-cap checks. Backs legal search (`/dashboard/search/legal`), the general assistant (`/dashboard/ai/assistant`), AI case analysis (`/dashboard/ai/case` — a *dispute* file: parties as plaintiff/defendant, possible defenses, case strength), AI contract review (`/dashboard/ai/contract` — a *bilateral agreement*: parties/keyTerms/risks, via its own dedicated `buildContractReviewPrompt` — deliberately not the litigation-shaped `/api/cases`, since forcing a contract through that endpoint would produce a wrong-shaped result), and AI contract drafting + export (`/dashboard/ai/write` — real generated text and a real DOCX/PDF download, grounded in the same corpus).

There used to be a second backend — Anthropic (Claude), called directly from `src/lib/ai/client.ts` — for contract review specifically. Removed once every route that used it had migrated to `ailegal_hussein` and nothing referenced the module anymore (`@anthropic-ai/sdk` uninstalled with it, not just left unused). Document OCR is the one AI-adjacent feature that calls neither backend: real Tesseract.js, local, no external API key of any kind.

Everything is behind the same layering (auth → tenant scope → rate limit → provider-configured check → monthly cost cap → call → audit log → usage log) and logs usage without content (`AiUsageLog` — feature/tokens/latency/success, never the question or answer). See [Known gaps](#known-gaps--not-built).

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | `output` is the default (Node server), not `export` |
| UI | React 19 | Server Components by default; `'use client'` only where interactivity requires it |
| Language | TypeScript | `strict` mode |
| ORM | Prisma 5 | MySQL provider |
| Database | MySQL | via `mysql2`; local dev runs XAMPP on `localhost:3307` |
| Styling | Hand-authored CSS (`globals.css`, `styles/dashboard-app.css`) + inline `style={{}}` props | Tailwind is configured (custom theme colors/fonts) and its Preflight base reset is active, but the app does not use Tailwind utility classes for layout/styling — grep the JSX and you won't find `hover:`, `md:`, etc. Don't assume a component is Tailwind-styled just because the dependency is present |
| Auth | Custom JWT in an httpOnly cookie (`ds_token`) | No third-party auth provider, no refresh-token pair — one long-lived signed token, invalidated via a `sessionVersion` bump (see [Auth](#auth--sessions)) |
| Email | Nodemailer via SMTP | Optional: if `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` aren't set, outgoing mail (password reset, notifications) is skipped and logged to the server console instead of failing |
| File storage | Local disk, `storage/case-documents/` | Not S3/R2/MinIO. Path-traversal-checked on both write and delete (`src/lib/document-storage.ts`) |
| Testing | Vitest | Two configs — unit (mocked/dummy env) and integration (real MySQL) — see [Testing](#testing) |
| Deployment | Hostinger Node.js hosting | `next build && next start`; see `HOSTINGER_DEPLOY.md`. No Docker, no Vercel, no container orchestration |

---

## Directory structure (actual)

```
src/
  app/
    page.tsx                 landing page (Server Component; fetches SiteSettings)
    login/                    auth: login, signup, 2FA, forgot/reset password
    dashboard/
      layout.tsx              server-side auth gate + shell (Sidebar/TopBar/modals)
      page.tsx                dashboard home
      clients/, cases/, sessions/, invoices/, team/, timelog/,
      calendar/, documents/ (+ search/ocr/compare/generate/sign),
      search/ (legal/office), reports/, email/, notifications/,
      moj/, settings/, backup/
                               one real route per dashboard section (see below)
    admin/                    platform-admin CMS panel (own login, not the office login)
    citizen/                  read-only portal for a client's own linked account
    api/                      Route Handlers — one folder per resource
    globals.css                site-wide reset + Tailwind directives
  components/
    landing/                  marketing page sections
    dashboard/                shared dashboard UI: ui.tsx (primitives), Sidebar,
                               TopBar, DashboardContext (modal/refresh state),
                               ModalOverlay, modals/ (10 modal components)
  lib/
    auth-server.ts             requireActiveUser/requireOfficeUser/requireOfficeManager/
                                requirePlatformAdmin/requireCitizenUser — the auth guards
                                every API route is built on
    session.ts                 Server Component equivalent of auth-server.ts (reads the
                                cookie via next/headers instead of a NextRequest)
    jwt.ts                     sign/verify the ds_token JWT
    prisma.ts                  the shared PrismaClient singleton
    tenant-scope.ts             Prisma where-clause builders enforcing office isolation
    financial-guards.ts         blocks destructive edits/deletes on paid invoices etc.
    pagination.ts                cursor-pagination helper used by list endpoints
    idempotency.ts               Idempotency-Key handling for POST endpoints
    api-security.ts              rate limiting, CSRF/cross-site checks, HTTPS detection
    api-handler.ts               withErrorHandling() — consistent JSON error responses
    audit.ts                    auditLog() — writes to AuditLog
    secret-crypto.ts             AES-256-GCM encryption for 2FA secrets
    env.ts                      fail-closed startup validation for JWT_SECRET etc.
    site-settings.ts             reads/writes the SiteSettings singleton row
    document-storage.ts          deletes on-disk files for removed Document rows
    dashboard/                  nav.ts (route map), types.ts, format.ts — dashboard-only
                                 shared config, not business logic
  styles/dashboard-app.css      shared by /login and every /dashboard/* route
  proxy.ts                 CSP (nonce-based) + security headers on every request
prisma/
  schema.prisma
  migrations/                   git-tracked, applied with `prisma migrate deploy`
storage/case-documents/         uploaded files (gitignored)
```

### Why `/dashboard/*` is real routes, not one page

Through Phase 2, `/dashboard` was a single ~4,000-line Client Component that held all ~25 "pages" as in-memory state and switched between them with a `page` variable — one giant client bundle, no deep links, no server-rendered auth check. Phase 3 split it into actual App Router routes (`/dashboard/cases`, `/dashboard/invoices`, etc.), each its own route file, so each is:

- **Deep-linkable and bookmarkable** — refresh, back/forward, and sharing a URL all work.
- **Separately code-split** — visiting `/dashboard/team` does not download the code for the other 24 sections. (Measured: the old `/dashboard` bundle was 38 kB page / 141 kB First Load JS; after the split, `/dashboard` itself is 2.3 kB / 114 kB, and every other section route is smaller still.)
- **Guarded server-side** — `dashboard/layout.tsx` reads the session cookie and calls `redirect('/login')` before any dashboard code reaches the browser, instead of the old pattern of rendering a loading spinner while a client-side `fetch('/api/auth/me')` decided whether to show a login screen.

A modal that's reachable from more than one page (add case, add client, etc.) is not duplicated per route — `DashboardContext` (a small client Context provided by the layout) holds `openModal`/`closeModal` and a `refreshKey`, and `ModalOverlay` renders whichever modal is open on top of the current route. A mutation inside a modal calls `notifySuccess()`, which bumps `refreshKey` (so client-fetched list pages re-run their effect) and calls `router.refresh()` (so any server-fetched data on the current route re-runs too), then closes the modal.

---

## Auth & sessions

- Login/signup/2FA verification/password reset issue a JWT (`src/lib/jwt.ts`, HS256, `JWT_SECRET` from env) set as an httpOnly, `SameSite` cookie named `ds_token`. There is no separate refresh token — the cookie itself is the session, checked fresh against the database on every request (not just decoded and trusted).
- `getActiveUserFromToken` (`auth-server.ts`) is the one place that decides whether a token is still a valid session: the user and their office must both be `active`, the token's `sessionVersion` must match the user's current `sessionVersion` in the database (bumped on password change or 2FA toggle, which is how "log out everywhere" works without a token blocklist), and if 2FA is enabled the token must carry `twoFactorVerified: true`.
- API routes call it via `requireActiveUser`/`requireOfficeUser`/`requireOfficeManager`/`requirePlatformAdmin`/`requireCitizenUser` (same file), each layering on a role check. Server Components (the dashboard layout, `/login`) call the equivalent `getSessionUser()`/`getFullAuthUser()` in `src/lib/session.ts`, which reads the cookie through `next/headers` instead of a `NextRequest` but runs the identical DB check (both funnel through `getActiveUserFromToken`, so there is exactly one implementation of "is this session still valid," not two that could drift).
- Roles: `OFFICE_MANAGER`, `LAWYER`, `CITIZEN`. There is no separate "secretary" or "accountant" role anywhere in the schema or the code, despite the marketing copy on the landing page listing package tiers — `/dashboard/settings`'s permissions matrix documents the roles that actually exist.
- Platform admin (the `/admin` CMS panel) is not a role — it's any `OFFICE_MANAGER` whose email is listed in `PLATFORM_ADMIN_EMAILS` (`isPlatformAdminEmail()` in `auth-server.ts`).
- 2FA secrets are stored encrypted (AES-256-GCM, `secret-crypto.ts`), never in plaintext.

## Tenant isolation

Every office's data is private to that office. This is enforced in the query layer, not the UI: `tenant-scope.ts` builds the Prisma `where` clause every list/detail/write endpoint uses (`visibilityWhere`/`writableWhere`-style helpers, scoped by `officeId` and, for lawyers, by ownership within the office). A cross-office lookup by ID returns 404, not 403 — the API never confirms that a record with that ID exists in someone else's office. This is covered by integration tests (`src/__integration__/tenant-isolation.integration.test.ts`) that seed two offices and assert one can never see the other's clients, cases, invoices, or documents, on any page of a paginated list.

## Data model

15 Prisma models: `Office`, `User`, `Client`, `Case`, `Session` (court session, not an auth session), `Invoice`, `Document`, `Notification`, `CalendarEvent`, `AuditLog`, `IdempotencyKey`, `PasswordResetToken`, `TimeEntry`, `SiteSettings`, `TrialRequest`. Everything except `SiteSettings` and `TrialRequest` belongs to an `Office`; those two are platform-level singletons/inbound-lead-capture with no office scope.

`SiteSettings` is a single-row table (fixed id `'singleton'`) holding the landing page's ticker text/colors, hero video, and published contact details — see [Public site settings](#public-site-settings-admin-cms).

## Financial data integrity

Paid or partially-paid invoices, and time entries already marked invoiced, can't be silently deleted or have their amounts edited out from under an existing payment record — `financial-guards.ts` is checked before any such mutation and returns a 409 with an explanation rather than allowing it.

## Pagination

List endpoints (`/api/cases`, `/api/clients`, etc.) use cursor pagination (`lib/pagination.ts`), not offset/limit — safe under concurrent inserts, no page-drift. Responses carry `X-Total-Count` (first page only), `X-Has-More`, and `X-Next-Cursor` headers. Covered by `src/__integration__/pagination.integration.test.ts` (walks every page, asserts no duplicates/gaps, confirms tenant isolation holds across pages).

## Idempotency

POST endpoints that create a record accept an `Idempotency-Key` header (`lib/idempotency.ts`, backed by the `IdempotencyKey` table) — a retried request with the same key returns the original result instead of creating a duplicate.

## Rate limiting & request security

`api-security.ts` provides in-memory rate limiting (bounded, not unbounded — old buckets are evicted) keyed by client IP, plus cross-site request rejection and HTTPS detection used for cookie `Secure` flags and CSP's `upgrade-insecure-requests`. The in-memory limiter is per-process: documented (not hidden) limitation is that it does not coordinate across multiple server instances — see the comment in `api-security.ts` for what that would take.

## Search

`/api/search` is plain MySQL `LIKE` queries across client names, case numbers/titles, invoice numbers, and document names — no full-text index, no external search service. This was evaluated against MySQL `FULLTEXT` during Phase 2 and kept as `LIKE` given current data volume; revisit if table sizes grow enough for it to matter.

## Public site settings (admin CMS)

The landing page's announcement ticker, hero video, and published contact details used to live in each visitor's own browser `localStorage`, written by whoever last opened `/admin` in that browser — no two people ever saw the same content, and nothing persisted server-side. `SiteSettings` (one row, `src/lib/site-settings.ts`) replaced that:

- `GET /api/site-settings` is public, used by the admin panel to populate its form.
- `PATCH /api/site-settings` requires `requirePlatformAdmin`, validates every field server-side (ticker item count/length, hex colors, a YouTube or `https://` mp4 URL for the hero video, a plausible phone/WhatsApp/email), and writes an `AuditLog` entry recording which fields changed.
- The landing page (`src/app/page.tsx`) reads settings directly via `getSiteSettings()` in a Server Component — no client fetch, no loading flash. Next.js can statically prerender that page (confirmed in `next build` output: `/` is `○ Static`), which means a saved change would only reach visitors on the next deploy without an explicit fix: `PATCH` calls `revalidatePath('/')` after a successful save, invalidating the cached page so the very next request regenerates it with the new data. This was verified end-to-end in production mode (`next build && next start`), not just in dev — dev's per-request rendering would have hidden the staleness bug that `force-dynamic`-free static prerendering exposes in production.

## Testing

Two Vitest configs:

- `npm test` (`vitest.config.mts`) — unit tests, dummy env vars, DB-free. Excludes `*.integration.test.ts`.
- `npm run test:integration` (`vitest.integration.config.mts`) — real queries against a separate `dostoori_test` MySQL database (never the dev DB), `fileParallelism: false` so tests don't race each other's writes. `src/__integration__/helpers.ts` provides `createTestOfficeUser`/`createColleague`/`testRequest`/`cleanupOffice` etc. for calling route handler functions directly (no HTTP server needed — a Next.js Route Handler is just an exported async function). Requires a one-time local setup documented at the top of `vitest.integration.setup.mts`: create the `dostoori_test` database and run `prisma migrate deploy` against it.

## Deployment

Hostinger Node.js hosting, single app instance: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build && npm start`. Full steps in `HOSTINGER_DEPLOY.md`, backup/restore procedure in `BACKUP.md`. `prisma/seed.ts` is local-dev-only and refuses to run when `NODE_ENV=production` unless `ALLOW_DEV_SEED=true` is set explicitly — it seeds accounts with known fixed passwords, which is exactly what you don't want on a real deployment.

Required environment variables (validated at startup — the app refuses to boot without them, regardless of `NODE_ENV`): `DATABASE_URL`, `JWT_SECRET` (32+ chars, rejected if it matches a known placeholder value), `TWO_FACTOR_ENCRYPTION_KEY` (same rule). Optional: `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_PORT`/`SMTP_FROM` for real outgoing email, `PLATFORM_ADMIN_EMAILS` (comma-separated, defaults to `admin@dostoori.jo`), `NEXT_PUBLIC_APP_URL`/`APP_URL` (used to build absolute links in emails; falls back to the request's own `Host` header if unset).

## Security headers

`proxy.ts` sets a per-request nonce-based CSP (`script-src` is nonce + `strict-dynamic`, no `unsafe-inline` for scripts), plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a restrictive `Permissions-Policy`, on every response. `style-src` keeps `'unsafe-inline'` as a deliberate, documented exception (see the comment block at the top of `proxy.ts`) because the app uses inline `style={{}}` props pervasively — removing that would require rewriting styling app-wide, which is out of scope for a CSP hardening pass.

---

## Known gaps / not built

Documented here so they're not mistaken for oversights elsewhere:

- **Nothing under `/dashboard/ai/*` or `/dashboard/search/legal` is a mockup any more** (see Overview — every AI feature now calls `ailegal_hussein`) — every one calls a real backend, and every one that can't reach it (service not configured) says so with a 503 rather than a fabricated answer. The general assistant forwards prior turns as `history`; `ailegal_hussein`'s `/api/chat` uses them only to rewrite a follow-up ("وهل ينطبق على...") into a standalone question before its normal single-question pipeline runs, so follow-ups resolve in context while each answer stays individually grounded and cited. `/api/chat` itself keeps no server-side conversation state.
- **MOJ portal integration doesn't exist.** `/dashboard/moj` links out to `services.moj.gov.jo` and shows a static how-to guide; there is no API integration, because the ministry doesn't publish one (see the guide's own copy).
- **Backup automation isn't wired up.** `/dashboard/backup` is a real page but every action on it is disabled — no storage provider is connected. `BACKUP.md` documents the manual `mysqldump` procedure actually in use.
- **Rate limiting doesn't coordinate across instances.** Fine for a single Node process; would need a shared store (e.g. Redis) to scale horizontally. Not a lie in the code — `api-security.ts` says so directly.
- **`/admin`'s subscriber list and free-trial-request table** are still static/hardcoded example rows, unrelated to the real `TrialRequest` table the landing page's signup form actually writes to (`/api/trial-requests` — fetched by the admin page into state but not yet rendered from). Out of scope for the SiteSettings work described above, which only covers the ticker/hero-video/contact-info section of that panel.

---

> Last updated: Phase 5 (ailegal_hussein legal-search integration). If you touch anything described above, update this file in the same change — that's the whole point of it existing.
