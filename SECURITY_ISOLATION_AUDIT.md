# Security & Isolation Audit — Tenant → Office → Employee → Resource

Evidence labels (see [AUDIT_REPORT.md §0](AUDIT_REPORT.md)): **MEASURED**, **TEST-SUITE**, **CODE-TRACED**, **UNVERIFIED**.

---

## 1. The actual tenancy model (from code, not docs)

```
Platform admin  (not a role — an OFFICE_MANAGER whose email ∈ PLATFORM_ADMIN_EMAILS)
      │
Office  ← THE TENANT. No Organization entity, no branches.
  ├── User (role: OFFICE_MANAGER | LAWYER | CITIZEN)
  ├── Client        (officeId, ownerId)
  ├── Case          (officeId, ownerId, lawyerId?, clientId)
  ├── Session       (officeId, caseId)            — court session, not auth
  ├── Invoice       (officeId, clientId, caseId?)
  ├── Document      (officeId, ownerId, caseId?)  — file at storage/case-documents/<officeId>/<userId>/…
  ├── DocumentSignature (officeId, documentId, signatureImageId, signerId)
  ├── TimeEntry     (officeId, userId, caseId?)
  ├── CalendarEvent (officeId, createdById?)
  ├── Notification  (officeId, userId)
  ├── AuditLog      (officeId?, actorId?)
  ├── AiUsageLog    (officeId, userId)            — metadata only, no content
  └── Subscription  (officeId unique)
Platform-level (no office): SiteSettings, TrialRequest, Plan, IdempotencyKey(userId), PasswordResetToken(userId), EmailVerificationToken(userId)
```
Source: `prisma/schema.prisma`. CODE-TRACED.

**Consequences:**
- "Organization → Offices → Employees" as posed in the audit brief **does not exist**. Office = organization = tenant.
- "Office A vs Office B inside one organization" reduces to **tenant vs tenant**, covered below.
- A multi-branch firm would have to be one office, where every manager sees everything, or several unrelated tenants with no sharing.

### Ownership fields per entity

| Entity | officeId | ownerId / userId | assignedTo | Ambiguity |
|---|---|---|---|---|
| Client | ✔ | `ownerId` (creator) | — | A lawyer may also see and **edit** a client they don't own if they own any case for it (`clientWritableWhere`) |
| Case | ✔ | `ownerId` | `lawyerId` | Visibility uses **ownerId only**. Assignment sets both (`cases/route.ts:77-89`), so they stay consistent unless the DB is edited directly |
| Session | ✔ | — (via `case.ownerId`) | — | Ownership inherited from the case |
| Invoice | ✔ | — (via `case.ownerId`, or `client.ownerId` if caseless) | — | When a case is deleted its invoices are detached; visibility then falls back to the client owner |
| Document | ✔ | `ownerId` | — | Visible to the owner **and** the case owner |
| TimeEntry | ✔ | `userId` | — | Clear |
| CalendarEvent | ✔ | `createdById` | — | Office-wide read; delete by creator or manager |
| Notification | ✔ | `userId` | — | Clear |

No composite foreign keys enforce "child.officeId == parent.officeId" (for example `Case.clientId → Client` in the same office). The application enforces this at every write (CODE-TRACED, listed in §5), not the database.

---

## 2. Authentication path (server-side, every request)

`requireActiveUser` → `rejectCrossSite` → `getActiveUserFromToken` (`src/lib/auth-server.ts:78-123`):
1. Verifies the HS256 JWT (issuer and audience pinned, `src/lib/jwt.ts`).
2. Re-reads the user from the DB and rejects if the user is inactive, the office is inactive, `sessionVersion` doesn't match, or 2FA is enabled but not verified in the token.
3. `requireOfficeUser` then rejects `CITIZEN` and applies the subscription gate. `requireOfficeManager` requires `OFFICE_MANAGER`. `requirePlatformAdmin` requires `OFFICE_MANAGER` plus an email in the list.

The role and officeId used for authorization come from the **DB row, not the token** (`auth-server.ts:103-113`). Changing role or office in a forged token is impossible without `JWT_SECRET`, and stale tokens are corrected by the DB read. CODE-TRACED.

Server Components use the same function (`src/lib/session.ts:20-23`), and `dashboard/layout.tsx` redirects server-side. CODE-TRACED.

---

## 3. Role-based access control — permission matrix

Roles discovered in code: `OFFICE_MANAGER`, `LAWYER`, `CITIZEN` (enum `Role`), plus "platform admin" (email list). There is no secretary or accountant role, despite the landing-page tiers.

| Resource | Platform admin | Office Manager | Lawyer (employee) | Citizen (client portal) | Unauthenticated |
|---|---|---|---|---|---|
| Other offices' data (cases/clients/docs…) | **DENY** (only office list and manager name/email) | DENY | DENY | DENY | DENY |
| Office list, manager emails, subscription status (all tenants) | ALLOW `admin/overview` | DENY | DENY | DENY | DENY |
| Suspend / activate / extend trial of any office | ALLOW | DENY | DENY | DENY | DENY |
| Trial requests (incl. national IDs) | ALLOW (read) | DENY | DENY | DENY | CREATE only |
| Public site settings | ALLOW (write) | DENY | DENY | DENY | READ |
| Organization/office settings | n/a (no settings entity) | n/a | n/a | n/a | n/a |
| Employees (team) — list | own office | ALLOW (office staff) | CONDITIONAL (self only) | DENY | DENY |
| Employees — create lawyer / deactivate / reset password | own office | ALLOW (incl. other managers in office) | DENY | DENY | DENY |
| Clients — read | own office | ALLOW (office) | CONDITIONAL (owner, or owns a case for the client) | own linked client only (via cases) | DENY |
| Clients — edit | own office | ALLOW | CONDITIONAL (same as read) | DENY | DENY |
| Clients — deactivate | own office | ALLOW | CONDITIONAL (owner only) | DENY | DENY |
| Cases — read/edit/delete | own office | ALLOW | CONDITIONAL (`ownerId == me`) | read own client's cases (**incl. internal notes**) | DENY |
| Cases — reassign lawyer | own office | ALLOW | DENY (ignored) | DENY | DENY |
| Sessions — read/edit/delete | own office | ALLOW | CONDITIONAL (on own cases) | read own (**incl. notes**) | DENY |
| Invoices — read/edit/delete | own office | ALLOW | CONDITIONAL (own case, or own client if caseless) | read own (**incl. notes**) | DENY |
| Documents — list/download/OCR/sign/delete | own office | ALLOW | CONDITIONAL (owner, or on own case) | DENY (count only via cases) | DENY |
| Time entries | own office | ALLOW (office) | CONDITIONAL (own) | DENY | DENY |
| Calendar events — read | own office | ALLOW (office) | ALLOW (office-wide) | DENY | DENY |
| Calendar events — delete | own office | ALLOW | CONDITIONAL (creator) | DENY | DENY |
| AI features (assistant, search, case/contract analysis, drafting) | own office | ALLOW | ALLOW (docs scoped as above) | DENY | DENY |
| AI history | n/a (not stored server-side) | n/a | n/a | n/a | n/a |
| Reports (office aggregates) | own office | ALLOW | DENY | DENY | DENY |
| Audit logs | own office | ALLOW (office) | DENY | DENY | DENY |
| Office data export (zip) | own office | ALLOW | DENY | DENY | DENY |
| Email relay | own office | ALLOW (any address, if email verified) | CONDITIONAL (visible client or colleague) | DENY | DENY |
| Create citizen account | own office | ALLOW | DENY | DENY | DENY |
| Notifications | own | own | own | own | DENY |

**Implementation evidence:**
- Scope helpers: `src/lib/tenant-scope.ts:14-105`.
- Role gates: `requireOfficeManager` in `team`, `reports`, `audit-logs`, `office/export`, `citizen/create-account`.
- `requirePlatformAdmin` in `admin/*`, `trial-requests` GET, `site-settings` PATCH.
- `requireCitizenUser` in `citizen/*`.
- The authorization matrix is exercised by `src/__integration__/authz-matrix.integration.test.ts` (TEST-SUITE).

---

## 4. Multi-tenant security report

| Boundary | Tested? | Result | Evidence | Risk |
|---|---|---|---|---|
| Organization → Organization (office → office) | TEST-SUITE + CODE-TRACED | **PASS** — cross-office GET/PATCH/DELETE on every resource returns 404; lists never leak on any page | `tenant-isolation`, `pilot-audit-idor` ("IDOR matrix — every tenant-scoped resource, every mutating method, two independent attacker firms"), `pagination` ("never returns another office's records on any page") — all pass | Low |
| Office → Office (inside one org) | N/A | Concept not implemented | schema | — |
| Employee → Employee (lawyer ↔ lawyer, same office) | PARTIAL TEST-SUITE + CODE-TRACED | **PASS** for cases, documents (tests). Sessions, invoices, time entries and clients were CODE-TRACED via the same helpers | `tenant-isolation` "a lawyer only sees cases they own"; `documents` "an unrelated lawyer in the SAME office … cannot delete it" | Low |
| Role → Role (lawyer → manager-only routes) | TEST-SUITE | **PASS** | `authz-matrix`, `office-export` ("a LAWYER … cannot run the office-wide export (403)") | Low |
| Role → Role (citizen → staff data) | CODE-TRACED | **PARTIAL FAIL** — citizens receive internal `notes` fields | Finding S-6 | Medium |
| Office manager → platform admin | CODE-TRACED | **FAIL (config-dependent)** — self-signup can claim the platform-admin email | Finding S-1 | Critical/High |
| User → Files | TEST-SUITE + CODE-TRACED | **PASS** — no public URL; download requires a scoped row; path-traversal checked; deleted rows → 404 | `pilot-audit-file-security`; `documents/[id]/download/route.ts:18-35` | Low |
| User → Cases | TEST-SUITE | **PASS** | as above | Low |
| User → Documents | TEST-SUITE | **PASS** | as above | Low |
| User → AI history | CODE-TRACED | **PASS (nothing stored)** — history is client-held React state, and `AiUsageLog` stores no content | `src/app/api/ai/assistant/route.ts:26-36`; `src/lib/ai/usage.ts` | Low (Dostoori side) |
| AI → Documents (Dostoori side) | TEST-SUITE | **PASS** — case-analysis, contract-review and OCR 404 on another office's documentId *before* any upstream call | `ai-and-signature` tests | Low |
| AI → Other tenant (upstream retrieval/storage) | NO | **UNVERIFIED** — `ailegal_hussein` receives file bytes and contract text, returns an `id`, and trusts an `X-Dostoori-Office-Id` header under one shared service key | `legal-rag-client.ts:107-150,178-183` | **High (unknown)** |
| Cache → Tenant isolation | CODE-TRACED | **PASS** — no Redis or AI cache. `React.cache` is per-request. Only `/` is statically cached, and it holds public data | `src/lib/session.ts:20,35`; build output | Low |
| Queue → Tenant isolation | N/A | No queues, workers or background jobs exist | ARCHITECTURE.md; repo search | — |

**Static sweep (CODE-TRACED):** I checked every `prisma.<model>.(findUnique|findFirst|findMany|update|updateMany|delete|deleteMany|count|aggregate|groupBy)` in `src/app/api` and `src/lib`. Each one is one of:
- (a) wrapped in a `*VisibilityWhere`/`*WritableWhere`/`*OwnedWhere` helper or an explicit `officeId` filter;
- (b) keyed on the authenticated user's own id or email;
- (c) preceded by a scoped lookup whose result id is then used;
- (d) intentionally platform-wide behind `requirePlatformAdmin`.

**No unscoped tenant query was found.**

---

## 5. Cross-entity write validation (prevents tying another office's objects together)

| Write | Validation | File |
|---|---|---|
| Case.clientId | `clientWritableWhere` (same office, and ownership for lawyers) | `cases/route.ts:71-75`, `cases/[id]/route.ts:79-86` |
| Case.lawyerId | `staffWritableWhere` (same office, staff role, active) | `cases/route.ts:79-86` |
| Invoice.clientId / caseId | client scoped; case scoped **and** `clientId` must match | `invoices/route.ts:69-83` |
| Session.caseId | `caseVisibilityWhere` | `sessions/route.ts:68-72` |
| TimeEntry.caseId | `caseVisibilityWhere` | `time-entries/route.ts:54-59` |
| Document.caseId | `caseVisibilityWhere` | `documents/upload/route.ts:50-56` |
| Citizen.clientId | `{ id, officeId }` | `citizen/create-account/route.ts:29-33` |
| Team PATCH target | `staffWritableWhere` | `team/route.ts:95-98` |

All CODE-TRACED; the invoice, case and document cases are also covered by TEST-SUITE.

---

## 6. Security findings

### CRITICAL

#### S-1 Platform-admin takeover via public signup
- **Evidence:**
  - `isPlatformAdminEmail()` falls back to `'admin@dostoori.jo'` when `PLATFORM_ADMIN_EMAILS` is unset (`src/lib/auth-server.ts:29-36`).
  - `requirePlatformAdmin` checks only role and email; it does not check `emailVerified` or 2FA (`auth-server.ts:150-155`).
  - `POST /api/auth/signup` creates an `OFFICE_MANAGER` for any unused email and issues a full session immediately, without verification (`src/app/api/auth/signup/route.ts:33-94`).
  - HOSTINGER_DEPLOY.md §11 lists `PLATFORM_ADMIN_EMAILS` as *optional*, and `deploy/deploy.sh` does not check it.
- **Affected component:** auth, `/admin`, `/api/admin/*`, `/api/trial-requests`, `/api/site-settings`.
- **Scenario:** An operator deploys without setting `PLATFORM_ADMIN_EMAILS`, or sets it to an address they have not yet registered. Anyone who signs up with that address first holds platform admin.
- **Impact:**
  - Enumerate every office with its manager name and email (`admin/overview/route.ts:24-50`).
  - Read all trial requests, including national ID numbers and phones.
  - Suspend any office (a full 402 wall).
  - Grant free "ACTIVE" subscriptions.
  - Rewrite the public site's contact phone, WhatsApp and email, enabling phishing of prospective customers.
  - Case contents are **not** exposed.
- **Reproduction (to confirm, CODE-TRACED):** On a staging instance with `PLATFORM_ADMIN_EMAILS` unset, register a new office with the default admin address, leave it unverified, then load `/admin`.
- **Recommended fix:**
  - Fail closed at boot if `PLATFORM_ADMIN_EMAILS` is unset (remove the default).
  - Require `emailVerified` **and** `twoFactorEnabled` for platform admin.
  - Better: make platform admin a DB flag set by a CLI/seed step, never derived from a self-chosen email.
- **Priority:** P0.

### HIGH

#### S-2 Password-reset / email-verification link poisoning via the Host header
- **Evidence:**
  - `requestOrigin()` uses `NEXT_PUBLIC_APP_URL || APP_URL`, else the request `Host` (`src/lib/email.ts:6-11`).
  - The link is built at `forgot-password/route.ts:37` and `email-verification.ts:84`.
  - `deploy/setup-nginx.sh` removes nginx's `default` site and forwards `Host $host`, so the app vhost becomes the default for unknown hosts.
  - `APP_URL` is marked optional in HOSTINGER_DEPLOY.md §11.
- **Scenario:** An attacker requests a reset for a victim's email with a forged `Host`. The victim receives a genuine email whose link points to the attacker's host. One click leaks the 30-minute token, and the attacker resets the password.
- **Impact:** Account takeover of any user, including office managers. It needs one click, but the email is authentic.
- **Reproduction:** With `APP_URL` unset and SMTP unset, POST `/api/auth/forgot-password` with a custom `Host` header. The server log line `[forgot-password] … رابط إعادة التعيين …` shows the attacker host.
- **Fix:** Require `APP_URL` at startup (add to `src/lib/env.ts`), never derive from `Host`. Also add `default_server` returning 444 in nginx.
- **Priority:** P0.

#### S-3 Confidential client data sent to an unaudited external service
- **Evidence:**
  - `analyzeCaseFile` posts the full file bytes (`legal-rag-client.ts:178-183`). The response has an `id`, which suggests upstream persistence.
  - `analyzeContract` posts up to 40,000 chars of contract text (`contract-review/route.ts:89`).
  - The upstream uses `OPENAI_API_KEY` and a Neon-hosted DB (`deploy/setup-vps.sh` "Still to do").
  - Tenant identity is an unauthenticated header under one shared key (`legal-rag-client.ts:121-125`).
- **Impact:** Unknown retention, cross-office exposure and sub-processor risk for privileged lawyer-client material. Also a PDPL compliance question.
- **Fix:** Audit `ailegal_hussein`. Contractually and technically confirm zero retention (or tenant-scoped retention with deletion). Document sub-processors in the privacy policy. Gate per office behind explicit opt-in.
- **Priority:** P0 for use on real client files.

#### S-4 Proxy body buffer silently truncates uploads over 10 MB
- **Evidence:**
  - `src/proxy.ts:83` matches all paths except static assets, **including `/api/documents/upload`**.
  - Next 16 buffers proxied request bodies up to `proxyClientMaxBodySize`, default 10 MB. Beyond that "only the partial body will be available … the request will not fail" (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`).
  - `next.config.ts` does not set it. The upload route allows 20 MB (`upload/route.ts:39`) and nginx allows 25 MB.
  - Integration tests call handlers directly, bypassing the proxy, so this is untested.
- **Impact:** 10–20 MB uploads fail (malformed multipart → 500) or store corrupted files. Which one happens is UNVERIFIED.
- **Fix:** Set `experimental.proxyClientMaxBodySize: '21mb'`, or exclude `/api/documents/upload` (and `sign`) from the proxy matcher. Add an HTTP-level test.
- **Priority:** P0 (data integrity).

### MEDIUM

| ID | Finding | Evidence | Scenario / Impact | Fix | Priority |
|---|---|---|---|---|---|
| S-5 | **Logout does not revoke the session** | `logout/route.ts:15` only clears the cookie; the JWT stays valid for 7 d (`jwt.ts` `expiresIn '7d'`); `sessionVersion` not bumped | A copied or stolen cookie survives logout (shared computers, XSS in a future feature) | Bump `sessionVersion` on logout, or keep a server-side session id; shorten TTL and add sliding refresh | P1 |
| S-6 | **Citizen portal leaks internal notes** | `citizen/cases/route.ts:23-37` uses `include` without `select`, returning every `Case` scalar incl. `notes`, `ownerId`, `lawyerId`; `citizen/sessions` returns `notes`, `judge`; `citizen/invoices` returns `notes` | Lawyers' private strategy notes become visible to the client | Explicit `select` allow-list for citizen endpoints | P0 (confidentiality) |
| S-7 | **Invoice deletion guard bypass** | `invoices/[id]/route.ts:32-46` lets any user with write scope (incl. a lawyer) set `paid:0`/`status:'UNPAID'` on a PAID invoice; the guard at `:90` then allows `DELETE` | A paid financial record is destroyed in two requests; contradicts ARCHITECTURE.md | Block `amount`/`paid` decreases on invoices with payments (or make them append-only payment rows); manager-only deletes; audit old values | P1 |
| S-8 | **Email relay usable for spam** | `email-authorization.ts:49-51`: any verified OFFICE_MANAGER may email *any* address; offices are self-service; a LAWYER can create a client with any email, then send (`clients/route.ts:57-67`) | Platform SMTP reputation abuse, up to 20 msgs/h per user | Restrict to verified client/colleague recipients for all roles, add per-office daily caps, or require admin approval for new offices | P1 |
| S-9 | **Rate limiting is per-process and IP-derived** | `api-security.ts:100-107`: the last `X-Forwarded-For` entry, else `x-real-ip`, else the literal `'local'` | Behind the documented nginx, OK. If the app is reachable directly, the last XFF entry is attacker-chosen (bypass), and clients without XFF share one `'local'` bucket (one attacker locks out everyone's login). Resets on restart | Trust XFF only from a configured proxy; add per-account login throttling/lockout; shared store when scaling | P1 |
| S-10 | **AI monthly cap is check-then-act and not plan-aware** | `usage.ts:44-55` counts then calls; no reservation. Hardcoded 500 vs `basic` plan's 100 | Concurrent requests overshoot the cap; the plan limit is not honored | Atomic reservation (insert a pending usage row first), and read `Plan.aiCallsPerMonth` | P2 |
| S-11 | **Email verification not required for anything except mail relay** | `grep emailVerified` → only `email/send/route.ts:64` | Unverified accounts get the full product incl. AI spend and platform admin (S-1) | Require verification for admin, AI and invites | P1 |

### LOW

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| S-12 | Audit-log and signature IP taken from the **first** XFF entry (client-controlled) | `audit.ts:20-26`; `documents/[id]/sign/route.ts:73` | Use the same trusted-hop logic as `clientIp` |
| S-13 | TOTP codes replayable within the ±1 step window; 2FA verify throttled per IP only | `totp.ts` `verifyTotpCode`; `2fa/verify/route.ts:12` | Store last used step per user; per-account attempt limit |
| S-14 | User enumeration via signup / team / citizen create (409 "email in use"); forgot-password timing differs (DB write + mail) | `signup/route.ts:34`; `forgot-password/route.ts:30-51` | Accept-and-email flow; constant-time path |
| S-15 | `scripts/seed-pilot-audit.mjs` has no production guard (creates known-password accounts, wipes `Firm-NN` offices) | file header, no `NODE_ENV` check | Add the same guard as `prisma/seed.ts:15` |
| S-16 | Deactivated client's citizen login keeps working | `requireCitizenUser` doesn't check `Client.active` (`auth-server.ts:157-163`) | Check `linkedClient.active`; deactivate the citizen user on client soft-delete |
| S-17 | `X-Powered-By: Next.js` header | MEASURED on `next start` response | `poweredByHeader: false` |
| S-18 | Public `/api/health` discloses whether SMTP and AI are configured | `health/route.ts:31-36` | Return detail only to an authenticated or internal caller |
| S-19 | Self-XSS surface in document "print": user input written with `document.write` into an `about:blank` popup | `dashboard/documents/generate/page.tsx` `printDoc` | Escape HTML; the nonce CSP likely blocks script execution (UNVERIFIED) |
| S-20 | Password policy: length ≥ 8 only, no breach or complexity check | `signup/route.ts:29`, `reset-password/route.ts:18` | Add a zxcvbn/HIBP-style check |

### Checked and found adequate (CODE-TRACED unless noted)

- **SQL injection:** Prisma only, no `$queryRawUnsafe`. The only raw query is `SELECT 1` in health.
- **XSS:** no `dangerouslySetInnerHTML` anywhere in `src`. React escapes. Outgoing email HTML is escaped (`email/send/route.ts:14-21`). The CSP is nonce-based with `strict-dynamic` (MEASURED headers).
- **Path traversal:** storage paths are server-generated. Read, delete and download re-check the root (`document-storage.ts:15-21`, `download/route.ts:28-35`). Covered by TEST-SUITE.
- **Uploads:** extension allow-list, MIME prefix, and magic-byte signature checks. Always served as `application/octet-stream` + `attachment`. TEST-SUITE covers exe/ELF/double-extension cases.
- **CSRF:** SameSite=Lax httpOnly cookie, plus `Sec-Fetch-Site`/`Origin` rejection on mutating methods (`api-security.ts:128-145`).
- **Secrets:** fail-closed validation of `JWT_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY` and `DATABASE_URL` (`env.ts`). 2FA secrets are AES-256-GCM at rest. No committed secrets were found in tracked files.
- **SSRF / open redirect / command injection:** no user-controlled outbound URLs or redirects. The AI service URL is env-only. No shell execution in the app.
- **Error leakage:** `withErrorHandling` returns a generic JSON 500. Sentry scrubs PII (`sentry-scrub.ts`, unit-tested).
- **No backdoors or debug routes found.** The only hardcoded privilege is the default admin email (S-1).
