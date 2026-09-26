# Production Gaps — Launch Blockers, Post-Launch Work, Roadmap

IDs refer to findings in [CORE_SYSTEM_AUDIT.md](CORE_SYSTEM_AUDIT.md) (C-*), [SECURITY_ISOLATION_AUDIT.md](SECURITY_ISOLATION_AUDIT.md) (S-*) and [AI_RAG_AUDIT.md](AI_RAG_AUDIT.md) (AF-*).

---

## 1. Launch blockers (must fix before any real user or real client data)

| # | Blocker | IDs | Why it blocks |
|---|---|---|---|
| B1 | Docker build and migrate pipeline broken: `npm ci` lockfile drift; `next build` needs a live DB for `/`; missing `public/`; lowercase `user`/`plan` in migrations | C-1, C-2, C-3, C-4 | The documented deployment cannot produce a running, migrated app (3 of 4 MEASURED) |
| B2 | Platform-admin takeover via self-signup (default `admin@dostoori.jo`; no verification or 2FA required) | S-1 | An outsider can control all tenants' subscriptions and see all offices plus lead PII |
| B3 | Reset/verify links built from the `Host` header when `APP_URL` is unset; nginx has no catch-all vhost | S-2 | One-click account takeover |
| B4 | Uploads of 10–20 MB truncated by the proxy body buffer | S-4 | Corrupted or failed legal documents |
| B5 | Citizen portal returns internal case, session and invoice notes | S-6 | Breach of lawyer work-product confidentiality to the client |
| B6 | Real client documents sent to an unaudited AI service (and OpenAI; Neon-hosted DB) | S-3, AF-5 | Unknown retention and cross-office exposure of privileged material; PDPL. *Workaround: disable case-analysis and contract-review on real data until audited* |
| B7 | Paid-invoice guard bypass | S-7 | Financial records destroyable in two requests; contradicts the documented guarantee |
| B8 | Signed documents and their cases cannot be deleted (500) | C-7 | Core workflow breaks as soon as signing is used |
| B9 | No off-host backups by default (cron and rclone are manual) | CORE §10 | Single-host disk loss = total data loss |
| B10 | AI answer quality completely unmeasured | AI_EVALUATION.md | Legal answers shown with "مُسند لمصدر موثّق" with no evidence the grounding claim holds. *Workaround: launch without AI, or behind an explicit beta flag with prominent disclaimers* |

---

## 2. Minimum work before a controlled pilot

1. **B1.** Rename to `` `User` ``/`` `Plan` `` in the two migrations. Existing Windows dev DBs need `prisma migrate resolve` or a checksum note. Regenerate the lockfile with the target npm. Make `/` dynamic (or catch DB errors in `getSiteSettings()` and fall back to defaults). Create `public/` or drop the COPY. Run the full `deploy.sh` on a clean Linux VM.
2. **B2 + B3.** Add `APP_URL` and `PLATFORM_ADMIN_EMAILS` to the fail-closed validation in `src/lib/env.ts`. Require `emailVerified && twoFactorEnabled` in `requirePlatformAdmin`. Add an nginx `default_server` that returns 444.
3. **B4.** `experimental.proxyClientMaxBodySize: '21mb'`, or exclude upload routes from `proxy.ts`. Add one HTTP-level upload test through `next start`.
4. **B5.** Explicit `select` allow-lists in `src/app/api/citizen/*`.
5. **B7.** Forbid lowering `paid`/`amount` once `paid > 0` (or model payments as append-only rows); manager-only invoice delete.
6. **B8.** Handle `DocumentSignature` in the document and case delete paths (block with 409 and an explanation, or cascade the signature image deliberately).
7. **B9.** Ship the backup cron plus off-host target as part of `setup-vps.sh`; alert on restore-drill failure.
8. **B6 + B10.** Either disable the AI features for the pilot, or run AI_EVALUATION.md and audit `ailegal_hussein` first.
9. Revoke the session on logout (bump `sessionVersion`) (S-5), and require email verification before AI and admin use (S-11).

---

## 3. Post-launch improvements (safe to defer)

| Item | IDs | Why it can wait |
|---|---|---|
| UI pagination for lists over 200 rows; fetch-by-id for edit modals | C-5 | Pilot offices will have fewer than 200 rows per list initially. Fix before any office crosses that |
| Money as `DECIMAL(12,3)` (JOD has 3 decimals) | CORE §8 | Rounding errors are small at pilot scale; migrate before invoicing volume grows |
| Input max-length validation; map P2000/P2003 to 4xx | C-8 | Produces 500s, not data exposure |
| Idempotency key cleanup and failure release; frontend sending the keys | C-9 | Backend already de-dupes when used |
| Per-account login lockout; TOTP replay guard; trusted-proxy XFF handling | S-9, S-13 | IP limits exist; nginx topology is documented |
| Email relay restrictions and caps | S-8 | Limited by 20/h per user and requires a verified manager email |
| Atomic, plan-aware AI cap | S-10, AF-7 | Overshoot is bounded by per-user rate limits |
| Bundle OCR language models in the image; worker pool; timeout | C-6, AF-6 | Only affects OCR/contract review; workaround is outbound access to jsdelivr |
| AI body-read timeout | AF-1 | Only matters when upstream misbehaves |
| Server-side conversation history | AF-3 | Only affects upstream prompt integrity |
| Remove `X-Powered-By`; health endpoint detail gating; seed-script prod guard | S-15, S-17, S-18 | Low risk |
| Relabel "✨ generate document" as templates (or wire to drafting); remove unverifiable landing stats | CORE §4 | Honesty and marketing, not security |
| Documentation fixes (ARCHITECTURE deployment section, model count, invoice-guard claim, stale Known-gaps) | AUDIT_REPORT §6 | No runtime effect |

---

## 4. Prioritized roadmap

### Phase 0 — Critical blockers
| Task | Problem | Action | Why | Priority | Dependency | Expected result |
|---|---|---|---|---|---|---|
| P0-1 | Deploy pipeline broken (C-1…C-4) | Fix migrations' table case, lockfile, build-time DB dependency, `public/` | Nothing else matters if it can't deploy | P0 | — | `deploy/deploy.sh` succeeds on a clean Ubuntu VM; add it as a CI job |
| P0-2 | Admin takeover (S-1) | Fail-closed `PLATFORM_ADMIN_EMAILS`; require verified email + 2FA; ideally a DB flag | Platform compromise | P0 | — | Self-signup can never yield platform admin |
| P0-3 | Reset poisoning (S-2) | Require `APP_URL`; nginx `default_server` | Account takeover | P0 | P0-1 | Links always use the configured origin |
| P0-4 | Upload truncation (S-4) | Raise `proxyClientMaxBodySize` or exclude upload routes | Document integrity | P0 | — | 20 MB PDF uploads byte-identical (HTTP-level test) |
| P0-5 | Citizen notes leak (S-6) | `select` allow-lists | Confidentiality | P0 | — | Citizen responses contain only intended fields (test) |
| P0-6 | AI data flow (S-3) | Decide: disable on real data, or audit `ailegal_hussein` plus DPA/consent | Privileged data leaves platform | P0 | — | Documented, consented, verified data path |
| P0-7 | Invoice guard (S-7) and signed-doc delete (C-7) | Guard edits of paid invoices; handle signature FKs | Data integrity | P0 | — | 409 with explanation instead of silent loss or 500 |

### Phase 1 — Production hardening
| Task | Problem | Action | Why | Priority | Dependency | Expected result |
|---|---|---|---|---|---|---|
| P1-1 | No off-host backups | Automate cron + rclone + restore-drill alert in `setup-vps.sh` | Recoverability | P1 | P0-1 | Nightly encrypted off-host backup, monthly verified restore |
| P1-2 | Logout doesn't revoke (S-5) | Bump `sessionVersion` on logout; shorter JWT TTL | Session hygiene | P1 | — | An old cookie is rejected after logout |
| P1-3 | Monitoring gaps | Set `SENTRY_DSN`; external uptime check on `/api/health`; app container healthcheck | Detect outages | P1 | P0-1 | Alerts on downtime and errors |
| P1-4 | No HTTP-level or E2E tests | Add a `next start` test suite that goes through `proxy.ts` (auth, upload, isolation smoke) and run it in CI | Current tests bypass the proxy and never caught S-4 | P1 | P0-1 | CI covers the real request path |
| P1-5 | Rate limiting (S-9) | Trusted-proxy IP; per-account lockout | Brute force / DoS | P1 | — | Login attempts limited per account |
| P1-6 | Pagination (C-5) | Cursor pagination in list UIs; GET-by-id for invoices and sessions | Data invisibility over 200 rows | P1 | — | All rows reachable |
| P1-7 | Money type | Migrate to DECIMAL | Financial accuracy | P1 | P0-1 | Exact sums |
| P1-8 | OCR runtime dependency (C-6) | Bake models into the image; timeout; worker reuse | Reliability | P1 | P0-1 | OCR works offline; fails fast |
| P1-9 | Docs drift | Rewrite ARCHITECTURE deploy, data-model and guarantees sections | Onboarding and ops correctness | P1 | — | Docs match code |

### Phase 2 — AI/RAG improvement
| Task | Problem | Action | Why | Priority | Dependency | Expected result |
|---|---|---|---|---|---|---|
| P2-1 | Engine unaudited | Full audit of `ailegal_hussein` (ingestion, retrieval, prompts, storage, auth, admin exposure) | All AI claims unverified | P0 for AI launch | access to repo | Findings list equivalent to this one |
| P2-2 | No evaluation | Run AI_EVALUATION.md with lawyer-filled gold answers; add to CI (nightly) | Measure grounding and hallucination | P0 for AI launch | P2-1 | Recall/citation/no-answer metrics with launch gates |
| P2-3 | Citations unverified (AF-2) | Return stable corpus IDs; verify existence and quote support before display | Fabricated citations are the top legal-AI risk | P1 | P2-1 | Zero unverifiable citations shown |
| P2-4 | Tenant identity upstream | Per-office signed claims (e.g. short-lived HMAC/JWT per request), not a bare header | Upstream can't trust the office id | P1 | P2-1 | Upstream enforces per-office retention and isolation |
| P2-5 | Forgeable history (AF-3) | Server-side conversation store scoped by user, or signed history | Injection surface | P2 | — | Client can't inject assistant turns |
| P2-6 | Body timeout (AF-1) | Overall deadline covering body consumption | Hung requests | P2 | — | 504 within budget |
| P2-7 | Contract truncation (AF-4) | Chunked review or explicit partial-review UX | Missed clauses | P2 | P2-2 | Whole-contract coverage |

### Phase 3 — Scale
| Task | Problem | Action | Why | Priority | Dependency | Expected result |
|---|---|---|---|---|---|---|
| P3-1 | In-memory rate limiter | Redis-backed limiter | Needed for >1 instance | P3 | — | Consistent limits across instances |
| P3-2 | Local-disk storage | S3-compatible object storage with per-office prefixes and signed short-lived URLs | Horizontal scale, durability | P3 | P1-1 | Stateless app nodes |
| P3-3 | Heavy work in request path | Queue for OCR, export, case analysis | Latency and CPU isolation | P3 | P3-1 | Requests return fast; jobs carry officeId/userId |
| P3-4 | `LIKE '%q%'` search | FULLTEXT (ngram parser for Arabic) or external search | Full scans at scale | P3 | — | Sub-second search at 10^5+ rows |
| P3-5 | Per-request auth + subscription DB reads | Short-TTL cache keyed by userId/officeId | DB load | P3 | P3-1 | Fewer queries per request |
| P3-6 | Load baseline | Run `scripts/audit-load-probe.mjs` / `scripts/load-ai.js` on staging, record p50/p95 | Replace ESTIMATED with MEASURED | P3 | P0-1 | Real capacity numbers |

### Phase 4 — Future
- Organization → multi-office (branch) hierarchy, if the market needs it. The current model has no organization level.
- Additional roles (secretary, accountant) that match the marketing tiers.
- Plan-limit enforcement (`maxUsers`, `maxCases`, `aiCallsPerMonth`), coupled with the payment work (out of scope here).
- A streaming AI UI, and a MOJ integration if an API ever exists.
- A real (qualified) e-signature provider, if legal signing is required.

---

## 5. What NOT to work on yet
- Horizontal scaling, Redis, queues (Phase 3). Irrelevant until B1–B10 are done and real load is measured.
- Payment gateway and Stripe wiring (out of scope; also depends on plan enforcement design).
- New AI features (drafting kinds, streaming, more tools) before P2-1/P2-2 establish that the existing ones are grounded.
- UI polish and visual redesign. Functional gaps (pagination, error surfacing) come first.
