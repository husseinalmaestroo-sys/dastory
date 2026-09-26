# Dastoori (دُسْتُورِي) — Production Readiness Audit

**Audit date:** 2026-09-26 · **Commit audited:** `dc6226b` (branch `claude/hopeful-ritchie-gip3i7`) · **Scope:** this repository only. Payment gateway out of scope.

Companion reports:

| File | Covers |
|---|---|
| [CORE_SYSTEM_AUDIT.md](CORE_SYSTEM_AUDIT.md) | Architecture, frontend, backend, database, auth, deployment, testing, performance, docs |
| [SECURITY_ISOLATION_AUDIT.md](SECURITY_ISOLATION_AUDIT.md) | Tenant → office → employee isolation, RBAC matrix, IDOR, security findings |
| [AI_RAG_AUDIT.md](AI_RAG_AUDIT.md) | AI/RAG pipeline, grounding, citations, AI security, AI isolation |
| [AI_EVALUATION.md](AI_EVALUATION.md) | AI evaluation dataset, metrics status, failure cases |
| [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md) | Launch blockers, post-launch work, phased roadmap |

---

## 0. How to read this report — evidence labels

Every claim carries one of these labels. They are not interchangeable.

| Label | Meaning |
|---|---|
| **MEASURED** | I executed it in this audit session and observed the result. |
| **TEST-SUITE** | Covered by the repository's own automated tests, which I ran and saw pass (real MySQL 8.0.46, not mocks). |
| **CODE-TRACED** | Established by reading the actual execution path. Not executed against a running server. |
| **UNVERIFIED** | Could not be checked: the code is outside this repo, or it needs credentials/infrastructure not available here. |

**Scope limitation that shapes this audit.** I did not run a live black-box HTTP probing campaign against a running server. The cross-tenant and IDOR conclusions rest on the repo's own real-database integration suites, which I ran, plus a complete static review of every route's Prisma queries. Findings the existing suites do not exercise are marked CODE-TRACED and include a reproduction recipe to confirm before fixing.

**The AI/RAG engine is not in this repository.** Retrieval, chunking, embeddings, ranking, prompts, the citation guard and the legal corpus all live in a separate service, `ailegal_hussein`. It is git-ignored here (`.gitignore:4-7`) and not accessible to this audit. Everything about AI retrieval quality, grounding, hallucination rate and AI-side tenant isolation is therefore **UNVERIFIED**. Only Dostoori's side of the HTTP boundary could be audited.

---

## 1. Executive summary

Dastoori is a single Next.js 16 + Prisma 5 + MySQL application: a case, client, invoice and document management system for Jordanian law offices. It adds AI features by calling the external `ailegal_hussein` RAG service over HTTP.

**What is genuinely good (verified):**
- **Tenant isolation between offices is well built.**
  - Every tenant query goes through `src/lib/tenant-scope.ts` helpers or an explicit `officeId` filter. My static sweep of every Prisma call in `src/app/api` and `src/lib` found no unscoped tenant query.
  - The repo's own cross-office, IDOR-matrix, pagination-isolation and authorization-matrix suites all pass against real MySQL (TEST-SUITE).
- **Auth sessions are re-validated against the DB on every request.** User and office must be active, `sessionVersion` must match, and 2FA must be verified (`src/lib/auth-server.ts:78-114`).
- **Engineering hygiene:** typecheck, lint and 160 unit tests pass (MEASURED). 294/300 integration tests pass (MEASURED); the 6 failures are environmental.

**What blocks launch:**

| # | Blocker | Evidence | Label |
|---|---|---|---|
| 1 | **The documented Docker deployment cannot build or migrate.** `npm ci` fails (lockfile out of sync). `next build` fails without a live DB, because `/` prerenders from MySQL. The Dockerfile copies a `public/` directory that does not exist. Two migrations use lowercase table names that do not exist on Linux MySQL. | See §3 | MEASURED (3 of 4), CODE-TRACED (`public/`) |
| 2 | **Platform-admin takeover by self-signup.** Platform admin is any `OFFICE_MANAGER` whose email is in `PLATFORM_ADMIN_EMAILS`, which defaults to `admin@dostoori.jo`. Public signup creates an `OFFICE_MANAGER` for any unused email with no email verification. Whoever registers that address first becomes platform admin. | `auth-server.ts:29-36,150-155`; `signup/route.ts:33-58` | CODE-TRACED |
| 3 | **Password-reset poisoning** when `APP_URL`/`NEXT_PUBLIC_APP_URL` is unset. The reset link is built from the request `Host` header. The shipped nginx config makes the app the default vhost. | `src/lib/email.ts:6-11`; `deploy/setup-nginx.sh` | CODE-TRACED |
| 4 | **Uploads between 10 MB and 20 MB break.** `proxy.ts` runs on `/api/*`. Next 16 buffers proxied bodies only up to 10 MB by default, and the upload route accepts up to 20 MB. | `src/proxy.ts:83`; `next.config.ts`; Next docs `proxyClientMaxBodySize.md` | CODE-TRACED (outcome UNVERIFIED) |
| 5 | **Client confidential data leaves the platform** to `ailegal_hussein` (and from there to OpenAI). Its retention, isolation and security are entirely unverified. | `legal-rag-client.ts:178-210`; `deploy/setup-vps.sh` (Neon, `OPENAI_API_KEY`) | CODE-TRACED + UNVERIFIED |
| 6 | **AI answer quality is unmeasured.** There is no evaluation set, no retrieval metrics, and no citation verification on Dostoori's side except contract-review excerpts. | `AI_EVALUATION.md` | UNVERIFIED |

---

## 2. Final verdict

### CORE SYSTEM — **NOT READY**
The application logic is solid for a pilot. But the documented deployment path does not work (4 independent build/migrate failures, 3 MEASURED). There are two config-dependent account-takeover paths. Several data-integrity defects remain: invoice guard bypass, undeletable signed documents, 200-row UI truncation, >10 MB uploads.

### MULTI-TENANT SECURITY — **CONDITIONAL**
- **Office↔office data isolation: SAFE BASELINE** (TEST-SUITE + CODE-TRACED; no IDOR found).
- **Platform level: UNSAFE until blockers 2 and 3 are closed.** One misconfigured environment variable lets an outsider become platform admin. That exposes the office list and manager emails, national-ID PII from trial requests, and suspend/activate power over every tenant. It does not expose case contents.
- **AI-side isolation: UNVERIFIED.**
- **No "organization" level exists.** `Office` is the tenant, and there are no branches within an organization (`prisma/schema.prisma`, model `Office`).

### AI/RAG — **NOT READY**
Dostoori's AI integration is honest: it returns 503 when the service is unconfigured (TEST-SUITE), strips invented contract excerpts, and shows grounded/disclaimer status. But the RAG engine is outside the audited code. Nothing about retrieval quality, grounding, hallucination control or corpus-side tenant isolation can be shown to work. Evaluation does not exist.

### OVERALL — **NOT READY**
It is close to a controlled pilot. With the Phase 0 blockers fixed, a small invite-only pilot (a handful of offices, no AI on real client documents until the AI service is audited) becomes defensible.

---

## 3. Measured test & build results

| Test | Result | Evidence |
|---|---|---|
| `npm ci` (Node 22.22.2 / npm 10.9.7, as used by `node:22-slim`) | **FAIL** | `Missing: @emnapi/runtime@1.11.3 / @emnapi/core@1.11.3 from lock file`. `Dockerfile:13` runs `npm ci`. |
| `prisma migrate deploy` on Linux MySQL 8.0.46 | **FAIL** | P3018 / MySQL 1146 `Table 'dostoori_test.user' doesn't exist`. The phase4 migration has `` ALTER TABLE `user` `` and `plan_price_nullable` has `` ALTER TABLE `plan` ``. Works only on case-insensitive MySQL (Windows/XAMPP dev). |
| Schema vs. migrations (after applying case-corrected copies to a scratch DB only) | PASS | `prisma migrate diff` → empty migration |
| `next build` with Dockerfile's build env (unreachable DB) | **FAIL** | `Error occurred prerendering page "/"` → `PrismaClientInitializationError` (`src/app/page.tsx:18` → `src/lib/site-settings.ts:46`) |
| `next build` with a live, migrated DB | PASS | 77/77 pages generated; `/` is `○ Static` |
| Dockerfile `COPY --from=build /app/public` | **FAIL** (CODE-TRACED) | No `public/` directory exists in the repo (`Dockerfile:53`) |
| TypeScript `tsc --noEmit` | PASS | exit 0 |
| ESLint | PASS | exit 0 |
| Unit tests (`npm test`) | PASS | 14 files, 160/160 |
| Integration tests (`npm run test:integration`, real MySQL) | PARTIAL | 20 files, **294/300 pass**. The 6 failures are all OCR tests: tesseract.js downloads language models from `cdn.jsdelivr.net` at runtime, and the sandbox proxy returned 403. The rejection surfaced as an *unhandled* error and each test hung to its 60 s timeout. |
| Tenant / IDOR / authz-matrix / pagination-isolation suites | PASS | TEST-SUITE: `tenant-isolation`, `pilot-audit-idor`, `authz-matrix`, `pagination` |
| E2E (browser) | NOT AVAILABLE | No E2E suite in repo |
| AI evaluation | NOT AVAILABLE | No dataset, no harness; engine not in repo |

---

## 4. Answers to the final questions

1. **Can the system technically be deployed?** Not via the documented Docker path as committed (§3, MEASURED). Manually, yes: fix migration case, build with a reachable DB, `next start`. That path is not what the docs describe.
2. **Can real users safely create accounts?** Mostly. Passwords are bcrypt (cost 10), sessions are DB-revalidated, and 2FA is available. But see blocker 2 (the admin email can be claimed by self-signup), blocker 3 (reset poisoning when `APP_URL` is unset), logout that does not revoke the JWT, and email verification that is enforced only for the mail relay.
3. **Can multiple organizations safely coexist?** Office↔office data isolation: yes (TEST-SUITE + CODE-TRACED). Platform-level: not until blockers 2 and 3 are fixed.
4. **Can multiple offices inside one organization safely coexist?** The concept does not exist. Each office is an independent tenant, so there is no intra-organization sharing and no organization admin.
5. **Can employees safely use the same office?** Yes, with a defined model. `OFFICE_MANAGER` sees everything in the office. `LAWYER` sees only cases they own, clients they own or have a case with, documents they own or on their cases, their own time entries, and only themselves in the team list. Calendar events are office-wide by design.
6. **Can one employee access another employee's private data?** A lawyer cannot access another lawyer's cases, documents, invoices, sessions or time entries (CODE-TRACED; partial TEST-SUITE). A manager can access all of them by design. The client portal (`CITIZEN`) receives lawyers' **internal case notes and session notes** (CODE-TRACED, `citizen/cases/route.ts:23-37`).
7. **Can one organization access another organization's data?** No path found (TEST-SUITE + CODE-TRACED). The exception is a hijacked platform-admin account, which gets metadata (office names, manager emails, lead PII) and suspend power, but not case contents.
8. **Can files leak across tenants?** No path found. Files are stored under `storage/case-documents/<officeId>/<userId>/`, are not publicly served, and download requires a tenant-scoped row lookup (TEST-SUITE: `pilot-audit-file-security`).
9. **Can cases leak across tenants?** No path found (TEST-SUITE).
10. **Can AI retrieval leak documents across tenants?** Dostoori never sends tenant documents to the Q&A retrieval path. Only the question, filters and client-supplied history are sent. Case-analysis and contract-review do send file bytes or text to `ailegal_hussein`, and case-analysis gets an `id` back, which implies storage. Whether that data is retained, indexed, or reachable across offices on the AI side is **UNVERIFIED**.
11. **Can AI memory leak across users?** Not on Dostoori's side: there is no server-side conversation store, and history lives only in React state (CODE-TRACED). The AI side is UNVERIFIED.
12. **Is authentication production-safe?** Conditionally. The core is sound. Needed first: fail closed on missing `APP_URL` and `PLATFORM_ADMIN_EMAILS`, revoke the session on logout, per-account lockout, and TOTP replay protection.
13. **Is authorization production-safe?** Tenant-level: yes. Platform-admin level: no (blocker 2). Role-level: yes, with the citizen-notes and invoice-guard issues.
14. **Is the database architecture production-safe?** No, as committed: migrations fail on Linux. Money is stored as `DOUBLE`. There are no composite FKs enforcing same-office relations (the app enforces this instead). Signed-document FKs make deletes 500.
15. **Is the AI grounded sufficiently in evidence?** UNVERIFIED. Dostoori relays upstream `grounded`/`sources` without checking them, except contract-review excerpts.
16. **Does the AI know when evidence is insufficient?** UNVERIFIED. The UI does display `grounded=false` and disclaimers when upstream sends them.
17. **Can the AI fabricate citations or articles?** Dostoori has no guard against it: sources are passed through as received (CODE-TRACED). Whether the upstream "citation guard" prevents it is UNVERIFIED.
18. **Top 10 issues:** see §5.
19. **Absolute launch blockers:** see [PRODUCTION_GAPS.md §1](PRODUCTION_GAPS.md).
20. **Minimum work before launch:** fix the build/migrate pipeline. Fail closed on `APP_URL` and `PLATFORM_ADMIN_EMAILS` and require verified email for platform admin. Raise `proxyClientMaxBodySize` (or exclude upload routes from the proxy). Stop exposing internal notes to citizens. Close the invoice-guard bypass. Handle signed-document deletes. Decide and document the AI data-processing path (DPA/consent). Keep AI off real client documents until `ailegal_hussein` is audited.
21. **What should NOT be worked on yet:** horizontal scaling/Redis, a payment gateway, streaming UI, a MOJ integration, new AI features. See [PRODUCTION_GAPS.md §3](PRODUCTION_GAPS.md).

---

## 5. Top 10 issues (ranked)

| # | Severity | Issue | Where | Label |
|---|---|---|---|---|
| 1 | CRITICAL (deploy) | Docker build and migrate chain broken in 4 places | `Dockerfile:13,27,53`; `prisma/migrations/2026082712424…/migration.sql:2`; `…131420…/migration.sql:2`; `src/app/page.tsx:18` | MEASURED ×3 / CODE-TRACED ×1 |
| 2 | CRITICAL (config-dependent) | Platform-admin takeover via self-signup with the default or not-yet-registered admin email | `src/lib/auth-server.ts:29-36,150-155`; `src/app/api/auth/signup/route.ts` | CODE-TRACED |
| 3 | HIGH (config-dependent) | Password-reset / verify-email link poisoning via `Host` | `src/lib/email.ts:6-11`; `forgot-password/route.ts:37` | CODE-TRACED |
| 4 | HIGH | Client data sent to an unaudited external AI service (and OpenAI); retention and isolation unknown | `src/lib/ai/legal-rag-client.ts:178-210` | CODE-TRACED / UNVERIFIED |
| 5 | HIGH | Uploads over 10 MB truncated by the proxy body buffer (route allows 20 MB, nginx 25 MB) | `src/proxy.ts:83`, `next.config.ts` | CODE-TRACED |
| 6 | MEDIUM | Citizen portal returns internal case/session/invoice notes | `src/app/api/citizen/{cases,sessions,invoices}/route.ts` | CODE-TRACED |
| 7 | MEDIUM | Paid-invoice deletion guard bypassable (`PATCH paid:0` → `DELETE`) | `src/app/api/invoices/[id]/route.ts:32-46,90` | CODE-TRACED |
| 8 | MEDIUM | Logout doesn't revoke the JWT (valid up to 7 days) | `src/app/api/auth/logout/route.ts:15` | CODE-TRACED |
| 9 | MEDIUM | UI never paginates: lists silently cap at 200 rows; sessions sort ascending, so the *newest* are dropped; edit modals look items up in the first page | `src/app/dashboard/*/page.tsx`, `EditSessionModal.tsx`, `EditInvoiceModal.tsx` | CODE-TRACED |
| 10 | MEDIUM | Signed documents (and cases containing them) cannot be deleted: FK `RESTRICT` → unhandled P2003 → 500 | `migration.sql:98-101`; `documents/[id]/route.ts:26`; `cases/[id]/route.ts:138-147` | CODE-TRACED |

---

## 6. Documentation vs. reality (headline discrepancies)

| Document says | Reality | Label |
|---|---|---|
| ARCHITECTURE.md "Deployment: Hostinger Node.js hosting … No Docker" | Repo ships Docker/compose/VPS tooling, and HOSTINGER_DEPLOY.md says shared hosting *cannot* work | CODE-TRACED |
| ARCHITECTURE.md "15 Prisma models" | 20 models (adds `EmailVerificationToken`, `AiUsageLog`, `DocumentSignature`, `Plan`, `Subscription`) | CODE-TRACED |
| ARCHITECTURE.md "paid invoices can't … have their amounts edited out from under an existing payment record" | `PATCH /api/invoices/[id]` edits `amount`/`paid`/`status` freely | CODE-TRACED |
| ARCHITECTURE.md Known gaps: "/admin's subscriber list … still static/hardcoded" | Now real (`/api/admin/overview`), so the doc is stale in the other direction | CODE-TRACED |
| ARCHITECTURE.md "Idempotency: POST endpoints accept an Idempotency-Key" | True server-side, but no frontend call ever sends one | CODE-TRACED |
| ARCHITECTURE.md "ailegal_hussein … own Postgres+pgvector" | `deploy/setup-vps.sh` configures ailegal with a Neon (hosted) `DATABASE_URL`, an undocumented third-party data processor | CODE-TRACED |
| HOSTINGER_DEPLOY.md §7 `docker compose run --rm app npx prisma migrate deploy` | `deploy/deploy.sh` itself notes `npx` doesn't work in the standalone image | CODE-TRACED |
| HOSTINGER_DEPLOY.md: `PLATFORM_ADMIN_EMAILS` and `APP_URL` "optional" | Both are security-critical (issues 2 and 3) | CODE-TRACED |
| Landing page: "10,000+ Jordanian legislations", "70% time saving", "24/7 support" (`src/components/landing/Stats.tsx`) | Hardcoded marketing numbers; the corpus size is in the external service and unverified | CODE-TRACED / UNVERIFIED |
| `/dashboard/documents/generate` "✨ توليد المستند" | Static string templates, not AI, including a canned legal conclusion | CODE-TRACED |
