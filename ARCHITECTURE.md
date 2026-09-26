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
| Deployment | Docker Compose on one Hostinger VPS, behind nginx | App image + MySQL 8.4; `deploy/deploy.sh` (versioned images, pre-migration backup, health-gated switch, rollback); see `HOSTINGER_DEPLOY.md`. No orchestration, single app instance |

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
- Platform admin (the `/admin` CMS panel, `/api/admin/*`) is not a role. `isPlatformAdmin()` in `auth-server.ts` requires ALL of: the `User.isPlatformAdmin` flag, which no HTTP route can set — only an operator on the server (`node scripts/platform-admin.mjs grant|revoke|list <email>`, audit-logged; revoking bumps `sessionVersion`); the email in the required `PLATFORM_ADMIN_EMAILS` allow-list (no default); a verified email; 2FA enabled, with the session having completed it; role `OFFICE_MANAGER`. Signing up with an allow-listed address grants nothing. A provisioned account missing a requirement gets 403 `platform_admin_requirements`.
- Logout bumps `sessionVersion`, so a captured cookie is dead immediately afterwards — on every device (there is one session version per user). Deactivating a user does the same, and reactivation does not revive old tokens.
- Password reset marks the email verified (the link proved control of it) and revokes existing sessions.
- Brute force: per-IP limits plus a per-account failure throttle (10 failures / 15 min keyed on the login email or the 2FA user, independent of IP, cleared on success) — `accountThrottle` in `api-security.ts`.
- Emailed links (reset, verification) are built only from `APP_URL` (required, validated in `env.ts`), never from the request's Host header. Tokens are never logged; with SMTP unconfigured the log says "email NOT sent" (links are printed only when `NODE_ENV=development` AND `DEV_LOG_EMAIL_LINKS=true`).
- Email verification gates: AI features, adding team members, creating client-portal accounts and the email relay all require a verified email (`requireVerifiedEmail`, 403 `email_not_verified`).
- 2FA secrets are stored encrypted (AES-256-GCM, `secret-crypto.ts`), never in plaintext. Known gap: a TOTP code is not marked used, so it can be replayed within its 30 s window (low risk: it still needs the password).

## Tenant isolation

Every office's data is private to that office. There is no organization level above an office. This is enforced in the query layer, not the UI: `tenant-scope.ts` builds the Prisma `where` clause every list/detail/write endpoint uses (`visibilityWhere`/`writableWhere`-style helpers, scoped by `officeId` and, for lawyers, by ownership within the office). A cross-office lookup by ID returns 404, not 403 — the API never confirms that a record with that ID exists in someone else's office. This is covered by integration tests (`src/__integration__/tenant-isolation.integration.test.ts`) that seed two offices and assert one can never see the other's clients, cases, invoices, or documents, on any page of a paginated list. `isolation-matrix.integration.test.ts` goes further: office vs office and lawyer vs lawyer in the same office across every object type, list, search, date-range filter, summary, dashboard and the office export. The office calendar is deliberately shared office-wide (only its creator or the manager can delete an event).

The client portal (`CITIZEN`) returns explicit field allow-lists (`src/lib/citizen-fields.ts`): no internal notes, no judge, no ownership ids. A deactivated client's portal login stops working.

## Data model

20 Prisma models: `Office`, `User`, `Client`, `Case`, `Session` (court session, not an auth session), `Invoice`, `Document`, `DocumentSignature`, `Notification`, `CalendarEvent`, `AuditLog`, `IdempotencyKey`, `PasswordResetToken`, `EmailVerificationToken`, `TimeEntry`, `AiUsageLog`, `Plan`, `Subscription`, `SiteSettings`, `TrialRequest`. Everything except `SiteSettings`, `TrialRequest` and `Plan` belongs to an `Office` (directly or through its user).

Text columns are validated for length before they reach MySQL (`src/lib/validation.ts`, `src/lib/field-specs.ts`), and Prisma errors that still get through map to clean responses in `api-handler.ts`: P2002 → 409 `duplicate`, P2003 → 409 `related_records`, P2000 → 400 `value_too_long`, P2025 → 404, P2034 → 409 `write_conflict`.

`SiteSettings` is a single-row table (fixed id `'singleton'`) holding the landing page's ticker text/colors, hero video, and published contact details — see [Public site settings](#public-site-settings-admin-cms).

## Financial data integrity

- Money is `DECIMAL(12,3)` (JOD has 3-decimal fils), handled as `Prisma.Decimal` on the server; inputs are parsed as strings with at most 3 decimals (`src/lib/money.ts`); JSON responses carry exact numbers. Totals come from the database (`/api/invoices/summary`), not from summing a page in the browser.
- `Invoice.paymentRecordedAt` is set the first time any payment is recorded and never cleared. An invoice with it set can't be deleted, even if `paid` is later corrected to 0 (that used to be a two-step bypass). Status is derived from the money (`resolveInvoiceStatus`), so "PAID" can't contradict `paid`.
- Updates are conditional on the values the edit was based on and deletes are a single conditional `deleteMany` — a PATCH racing a DELETE can't both succeed (409 `write_conflict`). Payment corrections are audit-logged with before/after.
- Time entries already invoiced can't be deleted (`financial-guards.ts`).
- Signed documents, their signature images and cases holding them answer 409 `signed_document` to DELETE (`signature-guards.ts`) — the signature audit trail is never destroyed.

## Pagination

List endpoints (`/api/cases`, `/api/clients`, etc.) use cursor pagination (`lib/pagination.ts`), not offset/limit — safe under concurrent inserts, no page-drift. Responses carry `X-Total-Count` (first page only), `X-Has-More`, and `X-Next-Cursor` headers. The dashboard lists use them (`usePaginatedList` + a "load more" control; filters and search run on the server), and edit modals fetch the record by id instead of searching the first page. Load failures show an error state with retry instead of an empty list. Covered by `src/__integration__/pagination.integration.test.ts` (walks every page, asserts no duplicates/gaps, confirms tenant isolation holds across pages).

## Idempotency

POST endpoints that create a record accept an `Idempotency-Key` header (`lib/idempotency.ts`, backed by the `IdempotencyKey` table) — a retried request with the same key returns the original result instead of creating a duplicate. A request that throws releases its key (the retry runs); a key left in flight by a crashed request is retaken after 2 minutes; keys older than 24 h are pruned. The dashboard's invoice and session forms send a key per submission.

## Rate limiting & request security

`api-security.ts` provides in-memory rate limiting (bounded, not unbounded — old buckets are evicted) keyed by client IP — which is only read from `X-Real-IP` / the last `X-Forwarded-For` hop when `TRUST_PROXY=1` (set in docker-compose.yml, behind the nginx config from `deploy/setup-nginx.sh`, which overwrites those headers); otherwise every request shares one bucket. Reads, updates and deletes have their own buckets, plus cross-site request rejection and HTTPS detection used for cookie `Secure` flags and CSP's `upgrade-insecure-requests`. The in-memory limiter is per-process: documented (not hidden) limitation is that it does not coordinate across multiple server instances — see the comment in `api-security.ts` for what that would take.

## Search

`/api/search` is plain MySQL `LIKE` queries across client names, case numbers/titles, invoice numbers, and document names — no full-text index, no external search service. This was evaluated against MySQL `FULLTEXT` during Phase 2 and kept as `LIKE` given current data volume; revisit if table sizes grow enough for it to matter.

## Public site settings (admin CMS)

The landing page's announcement ticker, hero video, and published contact details used to live in each visitor's own browser `localStorage`, written by whoever last opened `/admin` in that browser — no two people ever saw the same content, and nothing persisted server-side. `SiteSettings` (one row, `src/lib/site-settings.ts`) replaced that:

- `GET /api/site-settings` is public, used by the admin panel to populate its form.
- `PATCH /api/site-settings` requires `requirePlatformAdmin`, validates every field server-side (ticker item count/length, hex colors, a YouTube or `https://` mp4 URL for the hero video, a plausible phone/WhatsApp/email), and writes an `AuditLog` entry recording which fields changed.
- The landing page (`src/app/page.tsx`) reads settings directly via `getSiteSettings()` in a Server Component — no client fetch, no loading flash. It renders per request (`await connection()`), so `next build` never needs a database, and a saved change is visible on the next request; if the database is unreachable the page falls back to the built-in defaults (and reports the error to Sentry) instead of failing.

## Testing

Four layers (all run in CI, `.github/workflows/ci.yml`):

- `npm test` (`vitest.config.mts`) — unit tests, dummy env vars, DB-free. Excludes `*.integration.test.ts`.
- `npm run test:integration` (`vitest.integration.config.mts`) — real queries against a separate `dostoori_test` MySQL database (never the dev DB), `fileParallelism: false` so tests don't race each other's writes. `src/__integration__/helpers.ts` provides `createTestOfficeUser`/`createColleague`/`testRequest`/`cleanupOffice` etc. for calling route handler functions directly. Requires a one-time local setup documented at the top of `vitest.integration.setup.mts`: create the `dostoori_test` database and run `prisma migrate deploy` against it.
- `npm run test:http` (`vitest.http.config.mts`, `src/__http__`) — real HTTP to the production server (`node server.js` from the standalone bundle assembled by `scripts/assemble-standalone.mjs` into a directory OUTSIDE the repo, `NODE_ENV=production`, freshly migrated `dostoori_http_test`), so every request goes through `proxy.ts`: security headers, health, auth/logout, CSRF, tenant isolation, 20 MB upload byte-identity, body-size limits, every API route loading without a 5xx, PDF/OCR extraction. `HTTP_TEST_BASE_URL` points it at a running deployment instead (add `HTTP_TEST_BEHIND_PROXY=1` behind nginx).
- `npm run test:e2e` (Playwright, `e2e/`) — the core office workflow in a real browser against the same production server layout.

## Deployment

Docker on one VPS behind nginx (`HOSTINGER_DEPLOY.md`): `docker-compose.yml` runs MySQL 8.4 (pinned) and the app image (`Dockerfile`: `npm ci` → `prisma generate` → OCR models → `next build` → `scripts/assemble-standalone.mjs`; runtime is the standalone bundle, non-root, app files read-only to the app user, `HEALTHCHECK` on `/api/health`). `next build` needs no database.

`deploy/deploy.sh`: preflight → image tagged with the git commit → encrypted pre-migration backup (no backup, no deploy) → `prisma migrate deploy` from the new image while the old version keeps serving → switch → wait for the container's health AND the new version in `/api/health` → automatic rollback if unhealthy → smoke test. `deploy/rollback.sh [tag]` switches back by hand; the five newest images are kept. Migrations roll forward only; a failed one leaves the old version running and the recovery is the printed restore point (`BACKUP.md`). Backups: `BACKUP.md`, `deploy/setup-backups.sh`.

`prisma/seed.ts` and `scripts/seed-pilot-audit.mjs` refuse to run with `NODE_ENV=production`, and otherwise only with `ALLOW_DEV_SEED=true` / `ALLOW_PILOT_SEED=true` — they create accounts with known passwords.

Required environment variables (validated at startup — the app refuses to boot without them, regardless of `NODE_ENV`): `DATABASE_URL`, `JWT_SECRET` (32+ chars, rejected if it matches a known placeholder value), `TWO_FACTOR_ENCRYPTION_KEY` (same rule), `APP_URL` (public origin; every emailed link is built from it), `PLATFORM_ADMIN_EMAILS` (allow-list, no default). Optional: `SMTP_*` for outgoing email, `TRUST_PROXY=1` behind nginx, `SENTRY_DSN`, `AI_LEGAL_SERVICE_*`. Full list: `.env.example`.

## Security headers

`proxy.ts` sets a per-request nonce-based CSP (`script-src` is nonce + `strict-dynamic`, no `unsafe-inline` for scripts), plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a restrictive `Permissions-Policy`, on every response. `style-src` keeps `'unsafe-inline'` as a deliberate, documented exception (see the comment block at the top of `proxy.ts`) because the app uses inline `style={{}}` props pervasively — removing that would require rewriting styling app-wide, which is out of scope for a CSP hardening pass. `X-Powered-By` is off, HSTS is sent on HTTPS requests, and `robots.txt` keeps crawlers out of private areas. Verified on real responses by `src/__http__/platform.http.test.ts`.

## Uploads and OCR

Uploads are capped at 20 MB (`src/lib/upload-limits.ts`); `next.config.ts` sizes `proxyClientMaxBodySize` from the same constant — before, `proxy.ts` silently truncated any body over Next's 10 MB default and the route stored a damaged file. Declared or actual sizes over the limit get 413; content must match its extension. OCR (Tesseract) uses language models bundled at install time (`scripts/prepare-ocr-models.mjs`, never fetched from a CDN at runtime), one worker per document, a 20 s init and 45 s per-page deadline — an OCR problem answers 503/504 instead of hanging the request.

## AI boundary (Dastoori's side only)

The external legal AI service is out of scope here; Dastoori's side of the call: verified email required, an atomic per-office monthly cap (row-locked reservation — N concurrent calls can't all squeeze past the last slot; failed calls don't count), the office id sent upstream comes from the server-side session, and one deadline covers headers AND body (a stalled stream ends in 504). See `src/lib/ai/usage.ts`, `legal-rag-client.ts`.

---

## Known gaps / not built

Documented here so they're not mistaken for oversights elsewhere:

- **Nothing under `/dashboard/ai/*` or `/dashboard/search/legal` is a mockup any more** (see Overview — every AI feature now calls `ailegal_hussein`) — every one calls a real backend, and every one that can't reach it (service not configured) says so with a 503 rather than a fabricated answer. The general assistant forwards prior turns as `history`; `ailegal_hussein`'s `/api/chat` uses them only to rewrite a follow-up ("وهل ينطبق على...") into a standalone question before its normal single-question pipeline runs, so follow-ups resolve in context while each answer stays individually grounded and cited. `/api/chat` itself keeps no server-side conversation state.
- **MOJ portal integration doesn't exist.** `/dashboard/moj` links out to `services.moj.gov.jo` and shows a static how-to guide; there is no API integration, because the ministry doesn't publish one (see the guide's own copy).
- **Backups are server-side, not in the dashboard.** `/dashboard/backup` is still a disabled page; real backups are `deploy/backup.sh` (cron, encrypted, off-host via rclone, monthly restore drill, failure alerts) — see `BACKUP.md`.
- **Subscription plan limits are not enforced.** `Plan.maxUsers` / `maxCases` / `aiCallsPerMonth` are stored but not checked; every office is on the trial plan with no upgrade path until billing (Phase 3). What IS enforced: the subscription state gate (expired/suspended offices are blocked) and a fixed AI cap of 500 calls per office per month.
- **Landing-page claims need product review.** Copy such as court integration and "accurate automatic generation", and the marketing statistics, describe things the product does not do (see MOJ note above; document generation is template-based) — flagged for the product owner, not changed in code.
- **Rate limiting doesn't coordinate across instances.** Fine for a single Node process; would need a shared store (e.g. Redis) to scale horizontally. Not a lie in the code — `api-security.ts` says so directly.
- **`/admin`'s subscriber list and free-trial-request table** are still static/hardcoded example rows, unrelated to the real `TrialRequest` table the landing page's signup form actually writes to (`/api/trial-requests` — fetched by the admin page into state but not yet rendered from). Out of scope for the SiteSettings work described above, which only covers the ticker/hero-video/contact-info section of that panel.

---

> Last updated: Phase 1 core repair & production hardening (see PHASE1_REPORT.md). If you touch anything described above, update this file in the same change — that's the whole point of it existing.
