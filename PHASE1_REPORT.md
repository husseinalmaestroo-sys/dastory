# Dastoori — Phase 1 Report: Core System Repair & Production Hardening

**Baseline:** the audit at commit `dc6226b` ([AUDIT_REPORT.md](AUDIT_REPORT.md)).
**Phase 1 commits:** `9b65c76` → `b05e21a` (code), then this report, on branch `claude/hopeful-ritchie-gip3i7`.
**Report date:** 2026-09-26.

This one file holds all six required Phase 1 outputs as parts, following the earlier request for a single file ("كلهم بملف واحد").

**Evidence rule:** every result marked **PASS** below comes from a command that was actually run, with its output checked. Anything not run is marked **NOT RUN** or **CONDITIONAL**, with the reason. Nothing is claimed from reading code alone.

## Contents

| Part | Required output | Section |
|---|---|---|
| — | Verdict | [Verdict](#verdict) |
| 1 | CORE_FIX_REPORT.md | [Part 1 — Core fixes](#core-fix-report) |
| 2 | SECURITY_REGRESSION_REPORT.md | [Part 2 — Security regression](#security-regression-report) |
| 3 | DEPLOYMENT_VALIDATION.md | [Part 3 — Deployment validation](#deployment-validation) |
| 4 | TEST_RESULTS.md | [Part 4 — Test results](#test-results) |
| 5 | REMAINING_PHASE_2_AI.md | [Part 5 — Deferred to Phase 2 (AI)](#remaining-phase-2-ai) |
| 6 | REMAINING_PHASE_3_PAYMENT.md | [Part 6 — Deferred to Phase 3 (payment)](#remaining-phase-3-payment) |
| — | Blockers & operator actions | [Remaining blockers](#remaining-blockers) |

---

<a id="verdict"></a>
## Verdict

| Area | Verdict | Why |
|---|---|---|
| **Core system** | **PASS** | All P0/P1 core findings are fixed, each with a regression test. Unit, integration, HTTP-level and browser E2E suites pass, both on a clean clone and against the running production container. |
| **Security & isolation** | **PASS** | Every CRITICAL/HIGH finding in Dastoori's code is fixed and has a regression test (S-3 is the external AI engine — Phase 2). Isolation matrices pass: office vs office, lawyer vs lawyer, citizen allow-lists. Accepted LOW residuals are listed in [Remaining blockers](#remaining-blockers). |
| **Deployment** | **CONDITIONAL** | Everything the repository controls passed. The unmodified Dockerfile builds on GitHub CI, and the image migrates a fresh MySQL 8.4 and reports healthy. The deploy pipeline ran for real on a Docker Compose stack: versioned deploy, pre-migration backup, health-gated switch, automatic and manual rollback, failed-migration recovery, nginx in front, and encrypted backups with a verified copy, a passing restore drill and alerts. **Not executed:** a deployment on the real Hostinger VPS (DNS, certbot TLS), a real off-host storage account (an rclone remote on a separate path stood in) and a real alert channel. These are operator steps, and `setup-backups.sh` refuses to install cron unless a restore drill passes. |
| AI | **Deferred — Phase 2** | Only Dastoori's side of the boundary was hardened. |
| Payment | **Deferred — Phase 3** | Not touched. |

**Production-ready?** Not yet. The acceptance gates in the code are met. What remains is operator setup, which the scripts enforce: SMTP, the off-host backup remote, the alert webhook, an uptime monitor and platform-admin provisioning. AI must also stay off for real client files until Phase 2. See [Remaining blockers](#remaining-blockers).

---

<a id="core-fix-report"></a>
# Part 1 — CORE_FIX_REPORT

Each row maps a finding from the baseline audit (IDs from AUDIT_REPORT.md) to its fix and to the evidence that it works.

## 1.1 Deploy pipeline

| Finding | Fix | Evidence |
|---|---|---|
| `npm ci` failed: lockfile out of sync | Lockfile regenerated; `engines` pins Node 22 / npm 10.9 | `npm ci` exit 0 on a clean clone (Part 4) |
| Migrations failed on case-sensitive Linux MySQL (P3018: `` `user` `` / `` `plan` ``) | Table names corrected in 2 migrations; loose legacy SQL moved to `prisma/legacy/` (DO NOT RUN) | `migrate deploy` from an empty DB on MySQL 8.0.46 (`lower_case_table_names=0`) and on MySQL 8.4 (container). `prisma migrate diff` against schema.prisma → "No difference detected" |
| `next build` needed a live database (landing page prerendered from MySQL) | `/` renders per request (`connection()`); DB errors fall back to default settings and are reported to Sentry | Build exit 0 with `DATABASE_URL` pointing at an unreachable port (clean clone and repo) |
| Uploaded client files copied into the build output (`storage/` traced into `.next/standalone`) | `outputFileTracingExcludes` for storage/backups | A probe file in `storage/` is absent from `.next/standalone` after the build |
| Dockerfile incomplete; runtime missed files loaded by path | `scripts/assemble-standalone.mjs` is the one definition of the runtime layout, used by the Dockerfile AND the HTTP/E2E suites. App files root-owned, only `storage/` and `.next/cache` writable, `USER node`, `HEALTHCHECK` | Runtime image verified (Part 3). **Found during validation:** the image lacked tesseract.js worker deps (`bmp-js`, `zlibjs`, `wasm-feature-detect`) and `@napi-rs/canvas` (pdf-parse). Contract review returned 500 in the container — both fixed; see 1.8 |

## 1.2 Authentication & sessions

| Finding | Fix | Evidence |
|---|---|---|
| **S-1** Platform-admin takeover via signup | Admin = DB flag (`User.isPlatformAdmin`, set only by `scripts/platform-admin.mjs` on the server) AND email in the required `PLATFORM_ADMIN_EMAILS` (no default) AND verified email AND 2FA enabled and completed AND office manager | `platform-admin-security` (8 tests), HTTP test, CLI exercised inside the production container |
| **S-2** Reset/verification links built from the Host header | `APP_URL` is required at boot (`env.ts`); links are built only from it. Tokens are never logged (dev-only opt-in). nginx drops unknown Hosts (444) | `session-security` (forged Host/Origin/X-Forwarded-Host → link still on APP_URL; logs contain no token); nginx 444 measured |
| **S-5** Logout did not revoke the session | Logout bumps `sessionVersion` (conditional on the token's version); cookie cleared with the same flags | integration + HTTP + E2E: a captured cookie is 401 after logout |
| Deactivation / reactivation revived old tokens | Deactivation bumps `sessionVersion` | `session-security` |
| **S-11** Email verification gated almost nothing | `requireVerifiedEmail` on AI, team invites, client-portal account creation and the email relay. A password reset marks the email verified | `ai-boundary`, `email-relay-and-notifications`, HTTP (`403 email_not_verified`) |
| **S-9** Brute force only per IP (and IP spoofable) | Per-account failure throttle (10 / 15 min on login email and 2FA user, IP-independent); client IP trusted only with `TRUST_PROXY=1` (X-Real-IP / last XFF hop, must parse as an IP) | `session-security` (10 IPs → locked; success clears), `api-security.test.ts`, spoofed-header test through nginx |
| **S-12** Audit/signature IP from client-controlled first XFF entry | `getRequestIp` → `getClientIp` (trusted hop only) | unit tests |
| **S-16** Deactivated client's portal login kept working | `requireCitizenUser` checks `Client.active` | `citizen-confidentiality` |

## 1.3 Tenant isolation & confidentiality

| Finding | Fix | Evidence |
|---|---|---|
| **S-6** Citizen portal leaked lawyers' notes, judge, ownership ids | Explicit allow-list `select`s (`src/lib/citizen-fields.ts`); the portal no longer renders session notes | `citizen-confidentiality` (6): key-set equality with the allow-list, secret canaries absent |
| Isolation coverage was narrow | New matrix: office vs office and lawyer vs lawyer, across every object type, list, search, date range, summary, dashboard and export | `isolation-matrix` (10), plus existing suites; HTTP cross-tenant tests; E2E lawyer permissions |
| Cross-entity references (attaching another office's client/case) | Every create/update resolves references through tenant-scoped `where` | isolation tests; HTTP: office B → A's client = 400 |

## 1.4 Data integrity & money

| Finding | Fix | Evidence |
|---|---|---|
| **S-7** Paid invoice deletable via PATCH `paid:0` then DELETE | `paymentRecordedAt` (set once, never cleared) blocks deletion. Status derived from the money. Conditional PATCH, single conditional `deleteMany`. Corrections audited with before/after | `data-integrity`: bypass blocked; PATCH/DELETE race never both succeed |
| Money stored as FLOAT (0.1 + 0.2 ≠ 0.3) | `DECIMAL(12,3)` + migration (backfill verified on real data: `0.30000000000000004` → `0.300`); string parsing (≤ 3 decimals); exact JSON numbers; DB-side summaries | `money.test.ts`, `data-integrity`, E2E (150.250 JOD round trip) |
| Signed documents deletable → 500 / lost audit trail | 409 `signed_document` for signed docs, their signature images and cases holding them; block audit-logged | `data-integrity` |
| Over-long input → 500 (P2000) | Max-length validation from column sizes (`validation.ts`, `field-specs.ts`); Prisma errors mapped: P2002→409, P2003→409, P2000→400, P2025→404, P2034→409 | `data-integrity`, `api-handler.test.ts`, HTTP |
| Idempotency key poisoned forever on a crash | Released when the handler throws; stale in-flight keys retaken after 2 min; 24 h pruning | `data-integrity` (3 tests) |
| Notification bodies overflowing VARCHAR(191) vanished silently | `body` → TEXT; title/body fitted; failures logged + Sentry | `email-relay-and-notifications` |

## 1.5 Uploads & OCR

| Finding | Fix | Evidence |
|---|---|---|
| **S-4** `proxy.ts` silently truncated uploads over 10 MB | `experimental.proxyClientMaxBodySize` derived from `MAX_UPLOAD_REQUEST_BYTES` (`src/lib/upload-limits.ts`); 413 for declared or actual oversize; byte-length check | HTTP: exact 20 MiB file byte-identical by SHA-256 (direct and through nginx). **Proven regression test:** the same tests fail (3 × 400) when built without the fix |
| OCR hung forever when the CDN model download failed | Models bundled at install (`prepare-ocr-models.mjs`); local `langPath`; 20 s init / 45 s per page; one worker per PDF; OCR errors map to 503/504 | `ocr.test.ts`, 7 OCR integration tests offline, HTTP OCR on the production layout |

## 1.6 API behaviour & frontend

| Finding | Fix | Evidence |
|---|---|---|
| Lists showed only the first page; totals computed from one page | `usePaginatedList` + "load more"; server-side filters/search; summaries from `/api/invoices/summary`, `/api/time-entries/summary` | E2E; pagination integration tests |
| Edit modals searched the first page for the record | GET by id, with a load-error state | E2E (edit buttons); code |
| `.catch(() => {})` hid load failures as empty lists | `apiFetch` + `ErrorState` with retry across dashboard pages and modals. The remaining `.catch(() => {})` (3) are intentional best-effort cleanups (OCR worker terminate, idempotency key release) | lint/tsc; E2E |
| Rate-limit buckets shared between read/write; no DELETE limits | Separate read/update/delete buckets | integration |
| Document generator implied AI legal drafting | Honest subtitle/button ("إنشاء من القالب" — create from template), placeholder instead of a canned legal conclusion, escaped print (S-19) | code review; build |

## 1.7 Ops

| Item | Fix | Evidence |
|---|---|---|
| Reproducible deploy, no half-migrated live state | `deploy/deploy.sh` (see Part 3) | 6 real deploys in the sandbox |
| Versioning / rollback | Commit-tagged images, `current` tag, `deploy/rollback.sh`, `.deploy/history`, keep last 5 | manual + automatic rollback measured |
| Backups operational | Docker-mode scripts, verification, off-host copy check, retention, alerts, restore drill, `setup-backups.sh` | Part 3 §5 |
| Health / monitoring | `/api/health`: database, storage, OCR, version, no config leak (S-18), no-store; container `HEALTHCHECK`; monitoring documented | HTTP + container |
| Security headers | Nonce CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy, HSTS on HTTPS, no `X-Powered-By` (S-17), robots.txt | HTTP `platform.http.test.ts` |
| Seed scripts could run in production (S-15) | Both refuse `NODE_ENV=production` and need an explicit `ALLOW_*_SEED=true` | measured: exit 1 with the refusal message |
| Docs vs reality | ARCHITECTURE.md, HOSTINGER_DEPLOY.md, BACKUP.md, .env.example rewritten to match the code | — |
| CI | `.github/workflows/ci.yml` (checks + docker jobs) | green on GitHub Actions — [run 36233569058](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/36233569058) at `b05e21a` |

## 1.8 New defects found by Phase 1's own validation (all fixed)

| # | Defect | How found | Fix |
|---|---|---|---|
| N-1 | OCR broken in the Docker image: tesseract.js worker deps not traced | Package audit of `.next/standalone` | Dependency-closure copy in `assemble-standalone.mjs` |
| N-2 | `/api/ai/contract-review` (and every PDF extraction) failed in the image: `@napi-rs/canvas` loaded dynamically by pdfjs | `scripts/smoke.sh` during the first container deploy (HTTP 500) | Copy the closure of every `serverExternalPackages` entry |
| N-3 | The HTTP suite could not see N-2: the server ran inside the repo, so Node resolved missing packages from the repo's `node_modules` | Root-causing N-2 | HTTP/E2E servers run from a temp dir outside the repo; a probe build proves the tests now fail without the fix |
| N-4 | `docker compose run/up` referenced a non-existent `:latest` image and tried to rebuild (the restore drill's schema check hit it) | Failed-migration recovery test | `dostoori-app:current` maintained by deploy/rollback |
| N-5 | A staging build would have moved prod's image tag | Doc review while fixing N-4 | Separate `dostoori-app-staging` image |
| N-6 | `.env.example` shipped placeholder SMTP credentials, so every signup attempted a doomed SMTP login | Clean-clone deploy | SMTP commented out by default |
| N-7 | `npm test` picked up HTTP and Playwright tests | Clean-clone validation | Unit config excludes them |
| N-8 | A failed `git pull` silently deployed the old checkout | Deploy review | deploy.sh aborts |
| N-9 | `HOSTINGER_DEPLOY.md`'s manual `npx prisma migrate deploy` doesn't exist in the image | Container test | Documented the working command |
| N-10 | Copying the bundle rewrote Turbopack's relative `.next/node_modules/<pkg>-<hash>` symlinks as absolute paths into the build dir. On a clean install `pdf-parse` then loaded a partially traced `pdfjs-dist` (PDF 422, OCR 503) | Clean-clone HTTP run (and the first GitHub CI run) | Symlinks copied verbatim; the assembly fails if any link resolves outside the bundle |
| N-11 | CI docker job migrated before MySQL finished first-start init (socket ping succeeds early) | First GitHub CI run (P1001) | Ping over TCP, as the compose healthcheck already does |
| N-12 | The build downloaded the Cairo font from Google (`next/font/google`); the download failed once and failed the build. The font was also registered under a hashed family name, so the ~10 CSS rules and inline styles that ask for `'Cairo'` (inputs, buttons, dashboard shell) fell back to sans-serif | Clean-clone build failure | Cairo self-hosted (`public/fonts/cairo`, SIL OFL) under its real family name; E2E asserts the Arabic and Latin faces load under the production CSP |

---

<a id="security-regression-report"></a>
# Part 2 — SECURITY_REGRESSION_REPORT

"Tested at" says where each regression test runs: **I** = integration (route handler + real MySQL), **H** = HTTP (real socket → `proxy.ts` → Next → route → MySQL, production server), **C** = against the running production container, **N** = through nginx, **E** = browser E2E, **U** = unit.

| ID | Issue | Status | Regression tests | Tested at |
|---|---|---|---|---|
| S-1 | Platform-admin takeover | **FIXED** | allow-listed signup → not admin; unverified / no-2FA / 2FA-not-completed / not provisioned / not allow-listed → refused; smuggled `isPlatformAdmin` in signup ignored; positive control | I, H, C |
| S-2 | Host-header link poisoning | **FIXED** | forged Host + Origin + X-Forwarded-Host → link on APP_URL; unknown Host dropped by nginx | I, N |
| — | Tokens in logs | **FIXED** | console spy: no `resetToken=`, no 64-hex token; "email NOT sent" | I |
| S-4 | Upload truncation | **FIXED** | 20 MiB byte-identical; 12 MB (> old 10 MB cut); +1 byte → 413; 30 MB → 413 and nothing stored; **fails without the fix** | H, C, N |
| S-5 | Logout | **FIXED** | captured cookie → 401 on /me and data APIs; a stale token can't log out a newer session | I, H, E |
| S-6 | Citizen leak | **FIXED** | exact key allow-lists; canaries absent; staff still see notes; deactivated client → 403 | I |
| S-7 | Invoice bypass | **FIXED** | PATCH→DELETE bypass blocked; race never double-succeeds; status can't contradict money | I |
| S-8 | Email relay abuse | **MITIGATED** | verified sender; lawyer → inactive client refused; office daily cap 100 → 429; subject CR/LF stripped. The manager override (any address) is kept by design, bounded by the cap | I |
| S-9 | Rate-limit IP spoofing / per-IP only | **FIXED** | `getClientIp` unit tests; per-IP buckets; per-account throttle; spoofed X-Real-IP/XFF through nginx still land in the real client's bucket (429) | U, I, H, N |
| S-10 | AI cap race | **FIXED** (atomic); plan-aware: no | 10 concurrent calls with 1 slot → exactly 1 success; failures don't consume quota | I |
| S-11 | Verification gates | **FIXED** | AI (6 routes), team, portal, relay → 403 `email_not_verified` | I, H |
| S-12 | Audit IP from first XFF | **FIXED** | trusted-hop helper | U |
| S-13 | TOTP replay; 2FA throttle per IP | **PARTIAL** — per-account 2FA throttle added; replay within the 30 s window remains (LOW) | — | I |
| S-14 | User enumeration via 409 | **OPEN (LOW)** | — | — |
| S-15 | Pilot seed without prod guard | **FIXED** | measured refusal, exit 1 | manual |
| S-16 | Deactivated client portal login | **FIXED** | `citizen-confidentiality` | I |
| S-17 | X-Powered-By | **FIXED** | header absent | H, C |
| S-18 | Health disclosed config | **FIXED** | body has booleans + version only | H, C |
| S-19 | Print self-XSS | **FIXED** (escaped) | — (code) | — |
| S-20 | Weak password policy | **PARTIAL** — 8–128 chars enforced everywhere; no breach/complexity check (LOW) | — | I |
| — | CSRF | holds | foreign Origin → 403, nothing written; `Sec-Fetch-Site: cross-site` → 403 | H |
| — | Tenant / employee / IDOR | holds | isolation-matrix (10), tenant-isolation, pilot-audit-idor, authz-matrix; HTTP cross-office 404s; E2E lawyer can't see the manager's case or manage the team | I, H, E |
| — | Every API route loads without a 5xx in the production bundle | holds | anonymous sweep of all 81 route/method pairs | H, C, N |
| — | Container hardening | holds | uid 1000; CapEff 0; `no-new-privileges`; app files not writable by the app | C |
| — | Security headers | holds | nonce CSP (no unsafe-eval / unsafe-inline scripts), nonce used on the page, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS on HTTPS | H, C, N |
| S-3 | Client data sent to the external AI engine | **DEFERRED — Phase 2** | — | — |

Honesty notes:
- The "fails without the fix" proof was run for S-4 (built without `proxyClientMaxBodySize`: 3 upload tests failed with the truncated-body 400) and for N-2/N-3 (pristine bundle with the old package list: PDF extraction and OCR tests failed). For the other fixes, the regression tests were written against the fixed code; their pre-fix behavior is the baseline audit's CODE-TRACED finding.
- The safety-classifier-stopped live probe from the audit phase was not re-created. These are ordinary regression tests.

---

<a id="deployment-validation"></a>
# Part 3 — DEPLOYMENT_VALIDATION

## 3.0 Environment and its limits

- **Sandbox:** Ubuntu 24.04 container, Node 22.22.2, npm 10.9.7, Docker 29.3.1 (Compose v5.1.1), native MySQL 8.0.46 (`lower_case_table_names=0`), MySQL 8.4.11 image.
- **Egress policy:** HTTPS goes through an allow-listing proxy.
  - Docker Hub rate-limited the `node` pull, so the images came from `mirror.gcr.io/library/*`, Google's mirror of the same official images.
  - **`deb.debian.org` is blocked by policy**, so the Dockerfile's `apt-get install openssl` step can't run in any container here.
  - Build containers have no route to Google Fonts. The build used to fetch fonts from there; it no longer does (N-12).
  - Routing containers through the session proxy was refused by the environment's safety controls and was not pursued.
- **Consequently:** the unmodified production Dockerfile was built and run on GitHub's runners, and every stage of it was also built here with no network at all (§3.1). Everything after the image exists (compose, deploy, migrate, health, rollback, backups, nginx) ran for real in this sandbox.

## 3.1 Build

| Check | Result | How |
|---|---|---|
| `npm ci` on a clean clone | **PASS** (exit 0, 20 s) | `git clone` → `npm ci` (postinstall: `prisma generate` + OCR models) |
| `next build` with no database | **PASS** | `DATABASE_URL=mysql://build:build@127.0.0.1:1/build` (unreachable), clean clone |
| Production Dockerfile, unmodified, end to end | **PASS** (GitHub Actions) | `docker` job, [run 36233318276](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/36233318276) at `b576b6e` and [run 36233569058](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/36233569058) at `b05e21a`: `docker build` → `migrate deploy` on a fresh MySQL 8.4 from the image → container `healthy` → `/api/health` 200 → uid 1000 |
| Same Dockerfile, every stage, with **no network** (sandbox) | **PASS** | After N-12, all stages complete under `docker build --network none` (in-container `prisma generate`, OCR models, `next build`, assembly, runtime stage). The only diffs are the two steps that need the internet by nature: base `node:22-bookworm` (OpenSSL preinstalled) instead of `node:22-slim` + `apt-get`, and `COPY node_modules` instead of `npm ci`. The resulting image passed the full HTTP suite (111/111) against the compose database |
| Earlier attempt (before N-12) | informative | The same offline build stopped at the Google Fonts fetch; a clean-clone host build also failed once on that fetch |

## 3.2 Deploy flow (clean clone, real compose stack: MySQL 8.4 + app + nginx)

| # | Scenario | Result |
|---|---|---|
| 1 | First deploy (`9149e22`) on an empty database | Mechanics **PASS**: preflight, encrypted pre-migration backup, all migrations applied, health-gated switch, version reported. Smoke test **FAILED** → found N-2 (contract review 500) |
| 2 | Deploy the fix (`e307874`) via `git pull` | **PASS**: smoke 8 ✓, AI 2 skipped (unverified throwaway account — by design) |
| 3 | `rollback.sh` → previous, then `rollback.sh <tag>` forward | **PASS**: both healthy with the right version, `.deploy/history` updated |
| 4 | Broken release (image without OCR models → health 503) | **PASS**: detected unhealthy, **automatically rolled back**, deploy exit 1, service stayed healthy |
| 5 | Release with a half-applying migration (CREATE TABLE ok, then ALTER on a missing table) | **PASS**: P3018, deploy aborted before the switch, **old version kept serving (healthy)**. Recovery with `RESTORE_DB_DROP_FIRST=1` from the printed restore point: the stray table is gone, no failed migration row, all 17 offices present, healthy |
| 6 | Normal deploy (`38570ec`) | **PASS**: smoke passed, `current` tag moved, old images pruned to 5 |

Throughout: container healthy, uid 1000, CapEff `0`, `cap_drop: ALL`, `no-new-privileges`, app files read-only to the app user (`touch server.js` → permission denied).

## 3.3 HTTP-level suite against the deployment

| Target | Result |
|---|---|
| Container directly (`http://127.0.0.1:3000`) | **111/111 PASS** |
| Through nginx (`deploy/setup-nginx.sh` config; certbot stubbed — no public DNS here) | **94 PASS, 1 skipped by design** (the HSTS test injects X-Forwarded-Proto, which nginx overwrites), including the byte-identical 20 MiB upload |
| nginx: unknown Host / bare IP | connection dropped (444) |
| nginx: rotating spoofed X-Real-IP/XFF | still rate-limited as one client (429) |

## 3.4 Platform-admin provisioning in the container

- Signup with the allow-listed email: `isPlatformAdmin: false`; admin API 403.
- `grant` for an unknown email is refused. `grant` for the real email prints the missing requirements ("email not verified; 2FA not enabled").
- `list` shows NOT EFFECTIVE. The admin API returns 403 `platform_admin_requirements`.

## 3.5 Backups

The off-host target was a separate rclone remote (a local-backend remote standing in for B2/S3/SFTP), and alerts went to a local webhook receiver.

| Check | Result |
|---|---|
| `setup-backups.sh`: first backup (DB + files), off-host copy **verified by size**, restore drill, cron install only after the drill | **PASS** — drill: scratch DB restored, `prisma migrate status` from the deployed image "up to date", row counts, RTO 2 s |
| Encryption at rest | `openssl enc'd data with salted password`, mode 600; a wrong passphrase → `bad decrypt` |
| Files backup restore | 18/18 files byte-identical (SHA-256 lists equal) |
| Failure alert: database down during backup | exit 1 + webhook received `{"text":"dostoori database backup FAILED …"}` |
| Failure alert: corrupted backup in the drill | exit 1 + webhook received `{"text":"dostoori restore drill FAILED …"}`; scratch DB always dropped |
| Pre-migration backup on every deploy | **PASS** (restore point recorded in `.deploy/last_backup`, used in scenario 5) |

**Not verified here:** a real third-party storage account and a real alert channel. Both are operator configuration, and `setup-backups.sh` refuses to install cron unless a restore drill passes.

## 3.6 Other checks

- CI workflow YAML parses.
- The schema-drift step (`prisma migrate diff --exit-code`) passes against a freshly migrated DB.
- Seed scripts refuse production (exit 1).

---

<a id="test-results"></a>
# Part 4 — TEST_RESULTS

All counts are from runs in this session. "Clean clone" = a fresh `git clone` of the branch, `npm ci`, and a new database migrated from zero.

## 4.1 Clean-clone run (commit `b05e21a`, Node 22.22.2, npm 10.9.7)

| Step | Command | Result | Time |
|---|---|---|---|
| Install | `npm ci` | **PASS** (exit 0) | 20 s |
| Lint | `npm run lint` | **PASS** | 11 s |
| Typecheck | `npx tsc --noEmit` | **PASS** | 10 s |
| Unit | `npm test` | **PASS** — 16 files, **207/207** | 2 s |
| Migrations from empty (Linux MySQL 8.0.46, case-sensitive) | `prisma migrate deploy` + `prisma migrate diff --exit-code` | **PASS** — 7 migrations applied, "No difference detected" | 3 s |
| Integration (real MySQL, freshly migrated DB) | `npm run test:integration` | **PASS** — 27 files, **362/362** | 39 s |
| Build, database unreachable | `npm run build` | **PASS** | 30 s |
| HTTP-level (production server, bundle assembled outside the repo) | `npm run test:http` | **PASS** — 5 files, **111/111** | 10 s |
| Browser E2E (Playwright/Chromium) | `npm run test:e2e` | **PASS** — **3/3** | 13 s |

Earlier clean-clone runs of this same script failed and led to fixes, not to relaxed tests:
- at `3f34d02`, unit tests (N-7) and HTTP (N-10);
- at `6f2217b`, the build (N-12).

## 4.2 Other runs

| Suite | Target | Result |
|---|---|---|
| HTTP-level | production container | 111/111 |
| HTTP-level | through nginx (3 files) | 94 passed, 1 skipped by design |
| HTTP regression probe — upload fix removed | local | 3 failed as expected (truncated body → 400) |
| HTTP regression probe — old runtime package list, pristine bundle | local | 2 failed as expected (PDF 422, OCR 503) |
| Deployment scenarios | compose stack | 6 scenarios, all behaved as specified (Part 3 §2) |
| Backup/restore/alerts | compose stack | all checks in Part 3 §5 |
| GitHub Actions CI, [run 36233569058](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/36233569058) at `b05e21a` | `checks`: npm ci, lint, typecheck, unit, migrations from empty on MySQL 8.4 + drift check, integration, build with no DB, HTTP-level, E2E. `docker`: unmodified production Dockerfile build → migrate fresh MySQL 8.4 → healthy → uid 1000 | **both jobs green** |
| GitHub Actions CI, earlier runs | run 1 cancelled by a newer push; run 2 failed (HTTP: N-10; docker: N-11) → fixed; run 3 cancelled; run 4 at `b576b6e` green | — |

## 4.3 Test inventory added in Phase 1

- **Integration (new files):**
  - `platform-admin-security` (8)
  - `session-security` (9)
  - `citizen-confidentiality` (6)
  - `data-integrity` (18)
  - `isolation-matrix` (10)
  - `ai-boundary` (5)
  - `email-relay-and-notifications` (6)
- **Unit:** `env`, `money`, `financial-guards`, `api-security` (client IP, account throttle), `ai/ocr`.
- **HTTP (`src/__http__`):** `platform`, `auth-isolation`, `uploads`, `ocr` (PDF text layer, image OCR, AI route loading), `routes` (81 route/method pairs).
- **E2E (`e2e/core-workflow.spec.ts`):**
  - anonymous redirect;
  - signup → client → case → upload + byte-identical download → session → decimal invoice → add lawyer → lawyer's narrower permissions → logout revokes.

---

<a id="remaining-phase-2-ai"></a>
# Part 5 — REMAINING_PHASE_2_AI

Phase 1 changed only Dastoori's side of the AI boundary: the verified-email gate, the atomic monthly cap that doesn't count failures, the office id taken from the server session, a deadline over headers and body (a stalled stream → 504), upstream error text capped, the export filename sanitized with a size limit, and bundled offline OCR. The engine (`ailegal_hussein`) — embeddings, retrieval, ranking, prompts, corpus, vector DB, model choice — was not touched.

Open for Phase 2, from AUDIT_REPORT.md Part 4–5:

1. **S-3 — confidential data to an unaudited service (P0 for real client files).** Case files and contract text go upstream; retention and sub-processors are unknown. Audit the engine, get zero-retention guarantees, document sub-processors (PDPL), and add per-office opt-in. Until then, keep AI off (`AI_LEGAL_SERVICE_*` unset) for offices with real client material.
2. **Tenant identity upstream** is a header under one shared key. Move to per-office credentials or signed tenant claims, and audit that the engine enforces them.
3. **Forged chat history.** `history` is forwarded as sent by the client. Keep conversation state server-side.
4. **Prompt injection.** No test set; instructions inside uploaded contracts go straight into prompts. Build an injection suite (the poisoned pilot documents exist).
5. **Grounding & citations** are relayed unvalidated. Add citation existence/support checks and claim-level grounding.
6. **Evaluation.** No gold set has been run. Execute the Part 5 dataset (retrieval, exact article, Arabic normalization, no-evidence, false premise, cross-tenant canaries) and set pass bars.
7. **Plan-aware AI quota.** The cap is a fixed 500 per office per month; `Plan.aiCallsPerMonth` is ignored. No token or cost accounting.
8. **Streaming to the UI** (the full answer is buffered today), latency measurements (p50/p95), malformed-SSE-frame handling.
9. **Case-analysis / draft output validation** (passed through as `any`; contract review is already validated).
10. **Landing-page AI claims** ("توليد تلقائي دقيق", accurate automatic generation) — product-owner review.

---

<a id="remaining-phase-3-payment"></a>
# Part 6 — REMAINING_PHASE_3_PAYMENT

Payment was out of scope and **not modified**. Stripe code and `billing/webhook` are untouched; the HTTP route sweep only confirms these routes load without a 5xx for anonymous callers.

For Phase 3:

1. **Billing is architecture only.** No live Stripe keys are read; `STRIPE_*` stay unset. Every office is on the basic trial with no upgrade path.
2. **Plan limits are not enforced.** `Plan.maxUsers`, `maxCases` and `aiCallsPerMonth` are stored but never checked (audited in Phase 1; documented in ARCHITECTURE.md "Known gaps"). The subscription *state* gate (expired/suspended → blocked) does work and has tests.
3. **Webhook security:** signature verification, idempotent event handling, replay protection — to be implemented and tested with Stripe's test mode.
4. **Invoices vs subscriptions.** Office invoices (client billing, now DECIMAL with payment history protected) are separate from platform subscription billing. Keep it that way, and reconcile subscription payments into `Subscription`, not `Invoice`.
5. **Admin "grant free ACTIVE subscription"** needs an audit trail and limits once real money is involved.
6. **Tax/receipts** (Jordan sales tax, e-invoicing requirements) — product/legal decision.

---

<a id="remaining-blockers"></a>
# Remaining blockers and operator actions

**Before the first real office** (operator actions; the scripts check or enforce most of them):

1. **SMTP.** Without it no one can verify their email, which gates AI, team invites and client-portal accounts.
2. **Off-host backups + alert webhook + `setup-backups.sh`.** Setup must end with "restore drill passed". Copy `BACKUP_ENCRYPTION_PASSPHRASE` and `TWO_FACTOR_ENCRYPTION_KEY` to a vault.
3. **An uptime monitor on `/api/health`**, and optionally `SENTRY_DSN`.
4. **Platform admin:** sign up, verify the email, enable 2FA, then `platform-admin.mjs grant`.
5. **First real VPS deploy.** Run `setup-vps.sh`, `deploy.sh`, then `setup-nginx.sh` with real DNS. Certificate issuance (certbot) and the Hostinger network are the parts not exercisable here. `docker build` on the VPS needs the npm registry, Prisma's binary host and Debian apt; it is otherwise hermetic.
6. **Keep AI off for real client files until Phase 2** (S-3).

**Accepted residuals (LOW, documented):**
- TOTP replay within its window (S-13).
- User enumeration via signup 409 (S-14).
- No breach/complexity password check (S-20).
- In-memory rate limits (single instance only).
- Logout signs out all of a user's devices (one session version per user).
- The office calendar is shared office-wide by design.
- The email relay keeps the manager override (bounded by verification and a daily cap).
- `prisma.config.ts` holds a local dev URL. Prisma 5.22 ignores that file, but it would matter on a Prisma 6 upgrade.
- The landing page's marketing claims (court integration, statistics) need product-owner review.
