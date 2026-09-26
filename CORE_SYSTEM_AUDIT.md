# Core System Audit (non-AI)

Evidence labels: **MEASURED**, **TEST-SUITE**, **CODE-TRACED**, **UNVERIFIED** (see [AUDIT_REPORT.md §0](AUDIT_REPORT.md)).
Four separate claims are kept apart throughout: *code exists* ≠ *feature works* ≠ *feature is tested* ≠ *production-ready*.

---

## 1. System map

```
Browser ──► nginx (TLS, 25M body) ──► proxy.ts (CSP/headers, buffers body ≤10MB) ──► Next.js 16 App Router
                                                                                 ├─ Server Components (dashboard layout: server auth gate)
                                                                                 └─ Route Handlers src/app/api/** (54 route files)
                                                                                        │ Prisma 5
                                                                                        ▼
                                                                                   MySQL 8 (single DB)
                                                                                        │
                                                        local disk storage/case-documents/<officeId>/<userId>/…
Outbound: SMTP (optional) · Sentry (optional) · ailegal_hussein over HTTP (optional) · cdn.jsdelivr.net (tesseract models, at runtime)
```
- No Redis, no queue, no workers, no cron inside the app. Backups are host cron scripts.
- Single process. Rate limits are held in process memory.

---

## 2. Feature inventory

Status: IMPLEMENTED · PARTIALLY IMPLEMENTED · MOCKED · PLACEHOLDER · BROKEN · UNVERIFIED · PRODUCTION-READY.

| Feature | Frontend entry | Backend entry | Entities | Tests | Status | Notes |
|---|---|---|---|---|---|---|
| Office signup | `/login` (`LoginClient.tsx`) | `api/auth/signup` | Office, User, Subscription | TEST-SUITE (billing) | IMPLEMENTED | Creates an OFFICE_MANAGER with no verification (S-1) |
| Login / logout | `/login`, Sidebar | `api/auth/login`, `logout` | User | TEST-SUITE | PARTIALLY IMPLEMENTED | Logout is client-side only (S-5) |
| 2FA (TOTP) | Settings | `api/auth/2fa`, `2fa/verify` | User | TEST-SUITE | IMPLEMENTED | No replay protection (S-13) |
| Password reset | `/login?resetToken=` | `forgot-password`, `reset-password` | PasswordResetToken | TEST-SUITE | IMPLEMENTED | Host-header poisoning if `APP_URL` unset (S-2); needs SMTP |
| Email verification | `/login/verify-email` | `verify-email`, `resend` | EmailVerificationToken | TEST-SUITE | IMPLEMENTED | Enforced only for the mail relay |
| Clients CRUD | `/dashboard/clients` + modals | `api/clients`, `clients/[id]` | Client | TEST-SUITE | IMPLEMENTED | Soft delete; UI shows first 200 only |
| Cases CRUD + assignment | `/dashboard/cases` + modals | `api/cases`, `cases/[id]` | Case | TEST-SUITE | IMPLEMENTED | Delete 500s when a document is signed (C-7) |
| Court sessions | `/dashboard/sessions`, calendar | `api/sessions`, `sessions/[id]` | Session | TEST-SUITE (partial) | PARTIALLY IMPLEMENTED | Asc sort + no UI pagination hides the newest sessions after 200 (C-5) |
| Invoices | `/dashboard/invoices` + modals | `api/invoices`, `invoices/[id]` | Invoice | TEST-SUITE | PARTIALLY IMPLEMENTED | Guard bypass (S-7); money as DOUBLE |
| Time log | `/dashboard/timelog` | `api/time-entries` | TimeEntry | none dedicated | IMPLEMENTED | "Invoiced" guard bypassable by design |
| Calendar events | `/dashboard/calendar` | `api/calendar-events` | CalendarEvent | pagination only | IMPLEMENTED | Office-wide visibility |
| Team management | `/dashboard/team` | `api/team` | User | authz-matrix | IMPLEMENTED | Only LAWYER can be created (no second manager via UI) |
| Document upload/download/delete | `/dashboard/documents` | `documents/upload`, `[id]/download`, `[id]` | Document | TEST-SUITE | PARTIALLY IMPLEMENTED | >10 MB via HTTP broken (S-4); signed docs undeletable (C-7) |
| E-signature (image + hash audit) | `/dashboard/documents/sign` | `documents/[id]/sign` | DocumentSignature | TEST-SUITE | IMPLEMENTED | Clearly disclosed as *not* a legal e-signature |
| OCR | `/dashboard/documents/ocr` | `documents/[id]/ocr` | Document | TEST-SUITE (tenant); OCR tests failed here | UNVERIFIED | Needs runtime download from `cdn.jsdelivr.net`; hangs if blocked (MEASURED) |
| Office search | `/dashboard/search/office`, `documents/search` | `api/search` | Client, Case, Invoice, Document | none dedicated | IMPLEMENTED | `LIKE` queries, tenant-scoped |
| Reports | `/dashboard/reports` | `api/reports` | aggregates | none | IMPLEMENTED | Manager-only |
| Dashboard home | `/dashboard` | `api/dashboard` | aggregates | none | IMPLEMENTED | |
| Notifications | `/dashboard/notifications` | `api/notifications` | Notification | none | IMPLEMENTED | Body is VARCHAR(191); overflow is silently dropped (`notify.ts` swallows errors) |
| Email relay | `/dashboard/email` | `api/email/send` | — | TEST-SUITE | IMPLEMENTED | Needs SMTP; spam risk (S-8) |
| Audit log viewer | Settings | `api/audit-logs` | AuditLog | none | IMPLEMENTED | |
| Office data export (zip) | Settings | `api/office/export` | all | TEST-SUITE | IMPLEMENTED | Built fully in memory (≤200 MB embedded) |
| Citizen (client) portal | `/citizen` | `api/citizen/*` | Case, Session, Invoice | none dedicated | PARTIALLY IMPLEMENTED | Leaks internal notes (S-6) |
| Subscription enforcement | SubscriptionGate | `auth-server.ts`, `billing.ts` | Subscription, Plan | TEST-SUITE | IMPLEMENTED | Plan limits (`maxUsers`/`maxCases`/`aiCallsPerMonth`) **not enforced anywhere** |
| Platform admin panel | `/admin` | `api/admin/*`, `site-settings`, `trial-requests` | Office, Subscription, TrialRequest, SiteSettings | TEST-SUITE | IMPLEMENTED | Takeover risk (S-1) |
| Landing page + trial form | `/` | `api/trial-requests` | TrialRequest, SiteSettings | none | IMPLEMENTED | Build-time DB dependency (C-1) |
| Payment / Stripe | — | `billing/webhook` | Subscription | unit | PLACEHOLDER | Out of scope; webhook only handles `deleted` |
| Document generation | `/dashboard/documents/generate` | — | — | none | **MOCKED** (static templates labelled "✨ generate") | |
| Document compare | `/dashboard/documents/compare` | — | — | none | IMPLEMENTED (client-side LCS diff of pasted text) | Not file-based |
| Backup UI | `/dashboard/backup` | — | — | — | **PLACEHOLDER** (all actions disabled) | Real backups are host scripts |
| MOJ portal | `/dashboard/moj` | — | — | — | **PLACEHOLDER** (static guide + link) | |
| AI features | `/dashboard/ai/*`, `search/legal` | `api/ai/*`, `search/legal` | AiUsageLog | TEST-SUITE (unconfigured path only) | UNVERIFIED | See AI_RAG_AUDIT.md |

**PRODUCTION-READY: none.** Even the best-covered features (cases, clients, tenant isolation) ship on a deploy pipeline that does not build (C-1).

### Core findings index (S-* IDs are in SECURITY_ISOLATION_AUDIT.md)

| ID | Severity | Finding | Evidence | Label |
|---|---|---|---|---|
| C-1 | CRITICAL | `next build` needs a live, migrated DB: `/` prerenders `getSiteSettings()` with no fallback, and the Dockerfile builds with a dummy URL | `src/app/page.tsx:18`, `src/lib/site-settings.ts:46`, `Dockerfile:27` | MEASURED |
| C-2 | CRITICAL | `npm ci` fails: lockfile out of sync (`@emnapi/runtime`, `@emnapi/core` 1.11.3) | `Dockerfile:13` | MEASURED |
| C-3 | CRITICAL | Migrations reference `user`/`plan` (lowercase) and fail on Linux MySQL | `prisma/migrations/20260827124240_…/migration.sql:2`, `…20260827131420_…/migration.sql:2` | MEASURED |
| C-4 | HIGH | Dockerfile copies non-existent `public/` | `Dockerfile:53` | CODE-TRACED |
| C-5 | MEDIUM | No UI pagination: lists cap at 200; sessions sort ascending so the newest drop off; edit modals search only the first page | dashboard pages, `EditSessionModal.tsx`, `EditInvoiceModal.tsx` | CODE-TRACED |
| C-6 | MEDIUM | OCR downloads models from `cdn.jsdelivr.net` at runtime, spawns a worker per call, and has no timeout; when blocked it hangs | `src/lib/ai/ocr.ts:10-33` | MEASURED (6 integration tests timed out) |
| C-7 | MEDIUM | Deleting a signed document, its signature image, or a case containing them hits FK `RESTRICT`, unhandled P2003 → 500 | `migration.sql:98-101`; `documents/[id]/route.ts:26`; `cases/[id]/route.ts:138-147` | CODE-TRACED |
| C-8 | LOW | No max-length validation on `VARCHAR(191)` fields; over-long input → P2000 → 500 | `clients/route.ts:53-67`, `cases/route.ts:57-107` | CODE-TRACED |
| C-9 | LOW | Idempotency key stuck at `responseStatus=0` if the handler throws, so retries get 409 forever | `src/lib/idempotency.ts:38-65` | CODE-TRACED |
| C-10 | LOW | With SMTP unset, reset and verification **links (bearer tokens)** are written to stdout | `forgot-password/route.ts:47`, `email-verification.ts:94` | CODE-TRACED |

---

## 3. What is actually verified working

Only items that I measured or that the repo's real-DB tests proved in this session:

- Signup, login (correct, wrong password, unknown email, deactivated user), 2FA setup/enable/verify, and password reset with token single-use, expiry and `sessionVersion` bump. TEST-SUITE.
- Email verification token lifecycle. TEST-SUITE.
- Client, case, invoice CRUD, duplicate-number 409s, and case deletion preserving paid invoices. TEST-SUITE.
- Cross-office isolation for cases, clients, invoices and documents on every page, and the IDOR matrix across 2 attacker firms. TEST-SUITE.
- Upload validation (extension, MIME, magic bytes, size cap, cross-office case attach). TEST-SUITE (handler-level, not through the proxy).
- Document signing hash audit trail. TEST-SUITE.
- Idempotency-Key de-duplication, sequential and concurrent. TEST-SUITE (backend only).
- Subscription grace/wall enforcement and admin suspend/activate/extend. TEST-SUITE.
- Office export completeness and isolation. TEST-SUITE.
- Admin overview real numbers. TEST-SUITE.
- AI routes return 503 (not fabricated output) when unconfigured, and 404 on another office's document. TEST-SUITE.
- `/api/health` real DB and storage checks; security headers (CSP nonce, XFO, nosniff, Referrer-Policy, Permissions-Policy). MEASURED on `next start`.
- Typecheck, lint, 160 unit tests. MEASURED.

---

## 4. What is mocked / demo-only / hardcoded

| Item | Where | What it really is |
|---|---|---|
| "Generate legal document ✨" | `src/app/dashboard/documents/generate/page.tsx` | Six fixed Arabic string templates filled with form fields. The "مذكرة دفاع" template hardcodes a legal conclusion ("…يثبت للموكل حقه الكامل"). No AI, no server call |
| Backup page | `src/app/dashboard/backup/page.tsx` | Every action disabled |
| MOJ integration | `src/app/dashboard/moj/page.tsx` | Static how-to plus external link |
| Landing stats | `src/components/landing/Stats.tsx:11-16` | Hardcoded "10,000+ legislations", "70% time saved", "24/7 support" |
| Payment | `src/lib/billing.ts`, `billing/webhook` | No provider; the webhook ignores `created`/`updated` |
| Plan limits | `PLAN_SEED_DATA` in `billing.ts:14-18` | Seeded, never read by any gate |
| Idempotency | `src/lib/idempotency.ts` | Works server-side; no client sends the header |
| Pagination | `src/lib/pagination.ts` | Works server-side; no client reads `X-Next-Cursor` |
| OCR | `src/lib/ai/ocr.ts` | Real Tesseract, but depends on downloading models from `cdn.jsdelivr.net` at first use (undocumented runtime dependency) |
| AI (all) | `src/lib/ai/legal-rag-client.ts` | Real HTTP client to an external service that is not in this repo |

---

## 5. Architecture assessment

| Aspect | Assessment | Evidence |
|---|---|---|
| Modularity / separation | Good for its size. Auth guards, tenant scope, pagination, idempotency, error wrapper and storage are each one module reused everywhere | `src/lib/*` |
| Coupling | Business logic lives inline in route handlers (no service layer). Acceptable now; it will duplicate as features grow | `src/app/api/**` |
| Single points of failure | One Node process, one MySQL, one local disk. Storage is not replicated; losing the host loses documents unless the backup cron plus rclone is configured by hand | `docker-compose.yml`; BACKUP.md |
| Failure isolation | AI and SMTP are optional and fail with explicit 503s. **OCR does not fail safely**: a blocked CDN hangs the request (MEASURED in tests). **AI body reads have no timeout** (A-3 in AI audit) | `ocr.ts:27`; `legal-rag-client.ts:117,137` |
| Async / background jobs | None. OCR (up to 30 pages), office export (≤200 MB zip in RAM) and AI calls (up to 60 s) all run inside request handlers | `extract-text.ts:21`; `office-export.ts:9` |
| Caching | Only React `cache()` per request and static `/`. No tenant-sensitive cache exists | build output; `session.ts` |
| Observability | Console logs; Sentry server-side if a DSN is set; `AuditLog` table. No metrics, tracing, uptime monitor or alerting in repo | `instrumentation.ts`; `sentry.server.config.ts` |
| Scalability | Stateless auth (JWT plus DB check) allows scaling, but the rate limiter (memory) and file storage (local disk) are single-host | `api-security.ts` header comment |

---

## 6. Frontend (functional)

| Check | Result | Label |
|---|---|---|
| Server-side auth gate on `/dashboard/*` | `dashboard/layout.tsx` redirects before rendering | CODE-TRACED |
| RTL / Arabic | `dir="rtl"`, Arabic UI text throughout, Cairo font self-hosted | CODE-TRACED |
| Loading / empty states | Most list pages have `loading` state; many fetches swallow errors (`.catch(() => {})`), so API failures show as empty lists rather than errors | CODE-TRACED (e.g. `invoices/page.tsx`, `sessions/page.tsx`, `calendar/page.tsx`) |
| Pagination | **None.** Every list calls the endpoint with no `limit`/`cursor` and gets the default first 200 | CODE-TRACED (`grep X-Next-Cursor` → 0 hits) |
| Edit modals | `EditInvoiceModal`/`EditSessionModal` fetch the whole list and find by id, so items beyond row 200 cannot be edited | CODE-TRACED |
| Mobile | Custom CSS grid classes; not visually tested | UNVERIFIED |
| Accessibility | Not audited with tooling; many icon-only emoji buttons | UNVERIFIED |
| Dead or fake controls | Backup (disabled), document generate (template), MOJ (static) | CODE-TRACED |
| XSS sinks | None found (`dangerouslySetInnerHTML` = 0); one `document.write` self-XSS in print preview | CODE-TRACED |
| E2E tests | None | — |

---

## 7. Backend

| Area | Assessment | Evidence |
|---|---|---|
| Validation | Hand-written type and emptiness checks per route; enum allow-lists; date parsing. **No max-length validation** on most `VARCHAR(191)` fields (client name, case title, etc.), so over-long input produces Prisma P2000 → generic 500 | `clients/route.ts:53`, `cases/route.ts:57-69`; `api-handler.ts` only maps P2002 |
| Error handling | `withErrorHandling` on most routes (P2002 → 409; else Sentry + 500). A few routes use their own try/catch. FK violations (P2003) are not mapped | `api-handler.ts:20-37` |
| Transactions | Used for signup, case delete, password reset, email verify, signing. Not used for invoice "guard then delete" or the AI cap check | CODE-TRACED |
| Idempotency | Invoices, sessions, calendar POST. A handler exception leaves the key `responseStatus=0` forever, so later retries always get 409 | `idempotency.ts:38-65` |
| Concurrency | Unique constraints on case/invoice numbers per office. Concurrent case PATCH is safe (TEST-SUITE). Trial-request email duplicate check is non-atomic (no unique index) | `trial-requests/route.ts:53-56` |
| Rate limiting | Per-route, per-user+IP, in-memory. Note mismatched bucket names: case/client **GET** uses the `…:update` bucket, **PATCH** uses `…:delete`, **DELETE** has none; case detail GET is limited to 120/h | `cases/[id]/route.ts`, `clients/[id]/route.ts` |
| Logging | `console.error` with error objects; forgot-password logs the full **reset link** to stdout when SMTP is unset (a secret in logs) | `forgot-password/route.ts:47`; `email-verification.ts:94` |

---

## 8. Database & data integrity

| Check | Finding | Label |
|---|---|---|
| **Migration portability** | Two migrations use lowercase `user`/`plan`, so they **fail on Linux MySQL** (default `lower_case_table_names=0`, used by the `mysql:8` image) | MEASURED |
| Schema ↔ migrations drift | None (after case fix) | MEASURED |
| Loose SQL files outside `migrations/` | `prisma/migration_2fa_audit_logs.sql`, `prisma/migration_multi_tenant_ownership.sql`, `prisma/migrate-2fa-secrets.ts`. Legacy and undocumented; risk of manual misuse | CODE-TRACED |
| Money type | `Invoice.amount/paid` are `Float` (`DOUBLE`), so rounding errors occur in sums and reports | CODE-TRACED `schema.prisma:181-182` |
| Tenant FK consistency | No composite FKs; same-office integrity is enforced only in app code (§5 of the security audit) | CODE-TRACED |
| Cascades | Mostly `RESTRICT`. `DocumentSignature` → `Document` is `RESTRICT` on both FKs, and neither delete path handles it, so **deleting a signed document, its signature image, or a case containing either returns 500** | CODE-TRACED `migration.sql:98-101`; `documents/[id]/route.ts:26`; `cases/[id]/route.ts:138-147` |
| Orphans | The sign route writes the file before its transaction, so a failed transaction leaves an orphan file. Case delete removes files after commit (best-effort, logged) | CODE-TRACED |
| Hard deletes | Lawyers can hard-delete their own cases (plus documents and sessions) with no approval or soft delete | CODE-TRACED |
| Indexes | Reasonable composite indexes on `(officeId, createdAt)`, `(officeId, ownerId)`, etc. No FULLTEXT; search is `LIKE '%q%'` (full scans at scale) | CODE-TRACED |
| String length | Most text is `VARCHAR(191)`: notification body, invoice notes, client address; see §7 | CODE-TRACED |
| Seed safety | `prisma/seed.ts` guarded by NODE_ENV; `scripts/seed-pilot-audit.mjs` unguarded | CODE-TRACED |
| `prisma.config.ts` | Hardcodes the dev URL `mysql://root@localhost:3307/dostoori`. Prisma 5.22 ignored it in my runs (the CLI used `DATABASE_URL`), but it would be honored after a Prisma 6 upgrade | MEASURED (ignored) / CODE-TRACED |

---

## 9. Authentication detail

| Question | Answer | Label |
|---|---|---|
| Can an unauthenticated user reach protected resources? | No. Every non-public route calls a `require*` guard; the dashboard layout redirects | TEST-SUITE (authz-matrix) + CODE-TRACED |
| Can a logged-out session remain usable? | **Yes**, until JWT expiry (7 days), if the cookie value was captured | CODE-TRACED (S-5) |
| Can sessions be reused incorrectly? | Password reset, admin password change and 2FA toggle bump `sessionVersion` (revokes all). Deactivating a user or office blocks immediately (DB check) | TEST-SUITE |
| Server-side checks consistent? | Yes, one implementation (`getActiveUserFromToken`) for API and RSC | CODE-TRACED |
| Password storage | bcrypt cost 10 | CODE-TRACED |
| Brute force | IP rate limit only (8/min login, 12/min 2FA); no per-account lockout | CODE-TRACED |
| Cookie flags | httpOnly, SameSite=Lax, `Secure` when HTTPS is detected via `x-forwarded-proto` | CODE-TRACED |
| Self-service password change | None for staff. Only via reset email or manager reset | CODE-TRACED |

---

## 10. DevOps / production

| Item | Status | Evidence |
|---|---|---|
| Dockerfile | **BROKEN**: `npm ci` fails (MEASURED); `COPY public` has no source dir (CODE-TRACED); `next build` needs a live DB (MEASURED) | `Dockerfile:13,27,53` |
| docker-compose | Health-checked MySQL, `restart: unless-stopped`, loopback-only ports, `mem_limit` 1500m, bind-mounted storage. **No healthcheck for the app container** | `docker-compose.yml` |
| Migrations in deploy | `deploy.sh` runs `migrate deploy`, which fails on Linux (MEASURED case bug) | `deploy/deploy.sh` |
| Staging | `docker-compose.staging.yml` exists and shares the prod AI service | file header |
| TLS / reverse proxy | nginx + certbot with redirect. No `default_server` catch-all (S-2). AI service admin exposed at `legal.<domain>` | `deploy/setup-nginx.sh` |
| Secrets | Generated by `setup-vps.sh` into `.env`; `APP_URL`/`PLATFORM_ADMIN_EMAILS` left manual and unchecked | `deploy/setup-vps.sh`, `deploy.sh` |
| Backups | Scripts are real (encrypted dumps, restore drill), but **cron and off-host rclone are manual**, and `DATABASE_URL` is not present in the Docker `.env`, so the operator must hand-craft it | BACKUP.md; `scripts/backup-db.sh` |
| Rollback | No image tagging or versioning; `deploy.sh` rebuilds from `git pull`. No down-migrations | `deploy/deploy.sh` |
| Monitoring | Sentry optional; no uptime/metrics/log shipping | — |
| Reproducibility | A new engineer cannot reproduce: `npm ci` fails, migrations fail on Linux, integration tests assume `root@localhost:3307` with no password | MEASURED |

---

## 11. Performance (all ESTIMATED unless marked)

| Load | Expected behaviour | First bottleneck |
|---|---|---|
| 10 users | Fine | — |
| 100 users | Fine for CRUD. OCR, export and AI hold request slots for seconds to a minute each | In-process OCR (CPU) and in-memory export |
| 1,000 users | Single Node process CPU; `LIKE '%q%'` search full-scans; every request does 2+ DB reads just for auth plus the subscription gate | CPU on one process; per-request auth/subscription queries |
| 10,000 users | Requires horizontal scaling, which is blocked by in-memory rate limiting and local-disk storage | Architecture (state on one host) |

- **MEASURED:** none. No load test was run in this audit; `scripts/audit-load-probe.mjs` exists but was not executed.
- **UNKNOWN:** real latency figures.
- The per-request auth path does `user.findUnique` + `subscription.findUnique` before any business query (CODE-TRACED).

---

## 12. Core system readiness table

| Area | Status | Severity | Evidence | Required action |
|---|---|---|---|---|
| Architecture | Adequate for pilot | Low | §5 | Move OCR/export off the request path before scale |
| Frontend | Partially ready | Medium | §6: no pagination, swallowed errors, mocked generate | Add pagination, surface errors, relabel templates |
| Backend | Mostly ready | Medium | §7: no length validation, P2003 unhandled, stuck idempotency keys | Input length limits; map FK errors; idempotency cleanup |
| Database | **Not ready** | High | §8: migrations fail on Linux; money as DOUBLE; signed-doc FK | Fix migration case; DECIMAL money; handle signature FKs |
| Authentication | Conditionally ready | High | §9; S-1, S-2, S-5 | Fail closed on `APP_URL`/`PLATFORM_ADMIN_EMAILS`; revoke on logout |
| Authorization | Ready at tenant level | Medium | SECURITY §3-4; S-6, S-7 | Citizen `select` allow-list; invoice guard |
| Multi-Tenancy | Safe baseline | Low | TEST-SUITE + static sweep | Keep an HTTP-level isolation test in CI |
| Office Isolation | N/A (no org level) | — | schema | Decide whether multi-branch is needed |
| Employee Isolation | Ready | Low | tenant-scope helpers + tests | Extend tests to sessions, invoices, time entries |
| File Isolation | Ready (handler level) | Medium | TEST-SUITE; S-4 | Fix proxy body limit; HTTP-level upload test |
| Security | Not ready | Critical | S-1…S-4 | Phase 0 fixes |
| APIs | Mostly ready | Medium | §7 | See backend |
| Testing | Good unit/integration; no E2E, no HTTP-level tests | Medium | §3 of AUDIT_REPORT | Add HTTP-level (through proxy) and E2E smoke |
| DevOps | **Not ready** | Critical | §10 | Fix Docker build, migrations, add app healthcheck, automate backups |
| Monitoring | Minimal | Medium | §5 | Uptime check, Sentry DSN, alerting on backup drill |
