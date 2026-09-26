# AI / RAG Audit

Evidence labels: **MEASURED**, **TEST-SUITE**, **CODE-TRACED**, **UNVERIFIED** (see [AUDIT_REPORT.md §0](AUDIT_REPORT.md)).

---

## 0. The single most important fact

**The RAG system is not in this repository.** These all live in `ailegal_hussein`, a separate Next.js + Postgres/pgvector service:
- retrieval, embeddings, chunking, ranking;
- prompts, LLM calls, the "citation guard";
- the Jordanian legal corpus.

That service:
- is git-ignored here (`.gitignore:4-7`, `.dockerignore`);
- is not on GitHub under this account (repository listing checked);
- was not available to this audit.

Dastoori is a **thin, authenticated HTTP client** to it (`src/lib/ai/legal-rag-client.ts`).

Therefore:
- Parts 20–22 (ingestion, embeddings, retrieval), 25–28 (grounding, legal behaviour, evaluation, metrics) and the upstream half of 23–24 and 29–31 are **UNVERIFIED**.
- Nothing here should be read as "the AI works" or "the AI is unsafe". The AI engine is *unaudited*.
- The legal corpus size ("10,000+ legislations", landing page) is **UNVERIFIED**.

What *could* be audited is everything Dostoori does before and after the call. That is below.

---

## 1. Pipeline, as actually implemented on the Dostoori side

```
User (OFFICE_MANAGER/LAWYER)
  → requireOfficeUser (auth + subscription gate)                           auth-server.ts
  → rateLimit per user+IP (10–20/h)                                        each route
  → input validation (length caps: question 2000, history 10×2000, draft fields 27×4000, notes 2000)
  → [doc features] tenant-scoped Document lookup → 404 if not visible      documentVisibilityWhere
  → isLegalRagConfigured() else 503                                        legal-rag-client.ts:19
  → isUnderMonthlyAiCap(officeId) (500 calls/office/month) else 429        usage.ts:44-55
  → [contract review] extractText() locally (PDF text layer → OCR ≤30 pages; DOCX; image OCR; TXT), truncate to 40k chars
  → HTTP POST to ailegal_hussein with X-Internal-Service-Key + X-Dostoori-Office-Id
        /api/chat            {question, filters?, history?}      (assistant, legal search)
        /api/cases           multipart file bytes                  (case analysis)
        /api/contract-review {contractText}                        (contract review)
        /api/draft           {kind:'contract', fields, notes}      (drafting)
        /api/draft/export    {draft, filename, format}             (DOCX/PDF export; no AI cap)
  ── UNVERIFIED BOUNDARY: query processing → retrieval → ranking → context → prompt → LLM → citation guard ──
  → parse SSE (chat) or JSON
  → [contract review only] schema check + drop risk excerpts not literally present in the contract text
  → auditLog (metadata: grounded, mode, sourceCount — no content) + AiUsageLog (tokens logged as 0/0)
  → JSON to browser; UI shows answer, grounded badge, disclaimer, sources
```
CODE-TRACED from `src/app/api/ai/*/route.ts`, `src/app/api/search/legal/route.ts` and `src/lib/ai/*`.

---

## 2. Part-by-part status

### Part 20 — Document ingestion
| Aspect | Dostoori side | Upstream corpus ingestion |
|---|---|---|
| Loading / parsing | `extract-text.ts`: pdf-parse v2 text layer; if <20 chars → rasterize and Tesseract OCR (`ara`+`eng`, ≤30 pages, refuses above); DOCX via mammoth; PNG/JPG OCR; TXT utf-8; DOC/XLS/XLSX refused | UNVERIFIED |
| Arabic handling | Tesseract `ara` model; no normalization (tashkeel, alef/ya forms) before sending | UNVERIFIED |
| Legal structure (articles/sections) | **Not preserved.** Output is flat text, and a contract is cut at 40,000 chars (`contract-review/route.ts:89`); the `truncated` flag is returned to the UI | UNVERIFIED |
| Chunking, metadata, versioning, dedup | n/a (Dostoori does not index) | UNVERIFIED |
| OCR runtime | Downloads models from `cdn.jsdelivr.net` on first use, one worker per image, no timeout. **MEASURED:** when the CDN is blocked, calls hang and the rejection is unhandled (6 integration tests timed out) | — |

### Part 21 — Embeddings · **UNVERIFIED**
There is no embedding code, model name, dimension, similarity function or index definition in this repo. It is unknown whether an embedding-model change would invalidate stored vectors.

### Part 22 — Retrieval · **UNVERIFIED**
The only retrieval controls Dostoori exposes are `filters: {category?, court?, year?}` on legal search, forwarded unvalidated beyond type checks (`search/legal/route.ts:27-35`). Everything else is unknown: hybrid/keyword search, RRF, reranking, top-k, thresholds, Arabic normalization, exact-article lookup.

### Part 23 — Cross-tenant AI/RAG isolation
| Stage | Where filtering happens | Label |
|---|---|---|
| User → query | Dostoori authenticates; the office id comes from the DB-validated session | CODE-TRACED |
| Document selection (case analysis, contract review, OCR) | `documentVisibilityWhere` before any upstream call; another office's `documentId` → 404 | TEST-SUITE (`ai-and-signature` suite) |
| Q&A retrieval corpus | Dostoori sends **no tenant documents** for retrieval, only the question, optional filters and history. If the upstream corpus is purely public legislation, there is nothing tenant-owned to leak via retrieval | CODE-TRACED (Dostoori) / UNVERIFIED (corpus contents) |
| Upstream persistence of tenant content | Case analysis uploads full file bytes and receives `id` (`CaseAnalysisResult.id`), which implies the file or analysis is **stored upstream**. Contract review sends up to 40k chars. Whether this is stored, embedded into the shared corpus, cached, logged or retrievable by another office is unknown | **UNVERIFIED — HIGH RISK** |
| Tenant identity across the boundary | One shared `AI_LEGAL_SERVICE_KEY` for all offices; the office is an unauthenticated header `X-Dostoori-Office-Id` (`legal-rag-client.ts:121-125`). Upstream can only trust it | CODE-TRACED |
| Upstream caching / RRF / reranking / conversation memory | Unknown | UNVERIFIED |
| Upstream exposure | `deploy/setup-nginx.sh` publishes the AI service at `https://legal.<domain>` (incl. `/admin`). Its auth is not auditable here | CODE-TRACED / UNVERIFIED |

**Verdict:** Dostoori does not pull another office's documents into an AI request (TEST-SUITE). Whether the AI service mixes tenants is **UNVERIFIED**, and the data flow makes it a real possibility worth checking.

### Part 24 — AI memory isolation
- Dostoori stores **no** conversation content server-side. History is React state in `src/app/dashboard/ai/assistant/page.tsx:17,27`. It is not in `localStorage` (`grep` → 0 hits) and is sent with each request. `AiUsageLog`/`AuditLog` store metadata only. CODE-TRACED.
- Employee A → Employee B, office → office: nothing on the Dostoori side to inherit. CODE-TRACED.
- **Weakness:** history is **client-supplied and unauthenticated** (`assistant/route.ts:26-36`). A user can forge prior `assistant` turns, and they are forwarded verbatim to the upstream "condense follow-up" LLM step. That is a prompt-injection channel into the upstream pipeline (CODE-TRACED; upstream effect UNVERIFIED).
- Upstream conversation or session memory: UNVERIFIED (ARCHITECTURE.md *claims* `/api/chat` keeps no server-side state).

### Part 25 — RAG grounding
| Check | Dostoori behaviour | Label |
|---|---|---|
| `grounded` flag | Relayed as-is from upstream `done` event; UI shows "مُسند لمصدر موثّق" or the disclaimer | CODE-TRACED |
| Citations (`sources[]`) | **Relayed without any validation.** No check that a cited article exists or that the answer text is supported by the excerpt | CODE-TRACED |
| Claim → evidence → citation | Not computed anywhere in Dostoori | — |
| Contract review excerpts | **Verified server-side**: any risk `excerpt` not literally present in the extracted text is blanked (`contract-review/route.ts:108-111`). Summary, parties and keyTerms are *not* verified | CODE-TRACED |
| Contract review legal sources | Relayed without validation | CODE-TRACED |
| Upstream "citation guard" | Described in comments; not auditable | UNVERIFIED |

### Part 26 — Legal AI behaviour (exact article, multi-source, ambiguous, insufficient evidence, jurisdiction, false premises, conflicts, no-answer) · **UNVERIFIED**
None of these could be exercised without the engine. See [AI_EVALUATION.md](AI_EVALUATION.md) for the ready-to-run dataset. On the display side, the UI surfaces `grounded=false` and disclaimers when upstream provides them (`search/legal/page.tsx:27-28,116-118`, `ai/write/page.tsx:177`).

### Part 29 — Prompt injection / AI security
| Vector | Dostoori-side control | Label |
|---|---|---|
| "Ignore previous instructions" in the question | None in Dostoori (length cap only); upstream handling unknown | UNVERIFIED |
| Forged `history` turns | None: forwarded verbatim (up to 10 turns) | CODE-TRACED weakness |
| Instructions embedded in uploaded contracts/case files | Contract text and case files go straight into upstream prompts. The repo seeds deliberately poisoned test docs (`scripts/seed-pilot-audit.mjs`), but no test ever sends them upstream | UNVERIFIED |
| Malicious metadata (file names) | Case analysis forwards `doc.name` as the multipart filename; the draft export filename is user-supplied (100 chars) | CODE-TRACED |
| System-prompt leakage | Dostoori holds no system prompt, so there is nothing to leak here; upstream unknown | CODE-TRACED / UNVERIFIED |
| Output injection (HTML/JS in model output) | React renders text (no `dangerouslySetInnerHTML`). The export response's `Content-Type` is relayed from upstream but served as `attachment` | CODE-TRACED |
| Unauthorized context injection | Dostoori adds no tenant context to Q&A | CODE-TRACED |
| Abuse of expensive endpoints | Per-user rate limits (10–20/h) and a 500 calls/office/month cap. The cap is racy (check-then-call) and counts failed calls too | CODE-TRACED |

### Part 30 — Prompt & model architecture
| Item | Finding | Label |
|---|---|---|
| Models, temperature, max tokens, context window, prompts, prompt versioning | Upstream; unknown. Dostoori logs `model: 'ailegal_hussein'` and 0/0 tokens (`usage.ts`) | UNVERIFIED |
| Structured output | Contract review is validated with `isValidResult` → 502 on malformed output. Case analysis and draft are passed through as `any` | CODE-TRACED |
| Timeouts | 30 s (chat, export) / 60 s (cases, contract review, draft) — **but the timer is cleared as soon as response headers arrive** (`legal-rag-client.ts:117,137`). SSE body reads (`consumeChatStream`, :280) and JSON body reads (`readJsonOrThrow`, :152) have **no timeout**, so a stalled upstream stream holds the request open indefinitely | CODE-TRACED |
| Retries / fallback model | None (reasonable; avoids double spend). No fallback path | CODE-TRACED |
| Streaming | Upstream streams SSE; Dostoori buffers the full stream, so the user waits for the full answer | CODE-TRACED |
| Cost control | Call-count cap only; no token or cost accounting in Dostoori; the plan's `aiCallsPerMonth` is ignored | CODE-TRACED |
| Duplicated work | Case analysis sends raw files (upstream extracts again); contract review extracts locally. Two extraction stacks to maintain | CODE-TRACED |

### Part 31 — AI failure handling (Dostoori side)
| Failure | Behaviour | Safe? | Label |
|---|---|---|---|
| Service not configured | 503 with an honest message, no fake answer | ✔ | TEST-SUITE |
| Network error | 502 | ✔ | CODE-TRACED |
| Timeout before headers | 504 | ✔ | CODE-TRACED |
| **Upstream stalls after headers** | **Hangs** (no body timeout) | ✘ | CODE-TRACED |
| Upstream 401 / 429 / 503 | 502 "key mismatch" / 429 with Retry-After / 503 "daily spend limit" | ✔ | CODE-TRACED |
| Upstream `error` SSE event, or no `done` event | 502 | ✔ | CODE-TRACED |
| Malformed SSE frame | Silently skipped (`legal-rag-client.ts:297-302`); a partially parsed answer can be returned if `done` still arrives | ~ | CODE-TRACED |
| Malformed contract-review JSON | 502 + usage log `malformed_output` | ✔ | CODE-TRACED |
| Retrieval returns 0 / poor results | Depends on upstream `grounded`/disclaimer; Dostoori adds nothing | ? | UNVERIFIED |
| Document extraction fails | 422 with a reason; scanned PDFs over 30 pages refused explicitly | ✔ | CODE-TRACED |
| OCR model download fails | Hangs; unhandled rejection | ✘ | MEASURED |
| Partial state | Only `AiUsageLog`/`AuditLog` rows; failures still count against the monthly cap | ~ | CODE-TRACED |

---

## 3. AI failure cases (Dostoori-side; observable without the engine)

**AF-1 — Stalled upstream stream**
- **Question:** any.
- **Expected:** timeout → 504 within ~30 s.
- **Retrieved evidence:** n/a.
- **Actual answer (CODE-TRACED):** request never completes; the Node request slot is held.
- **Citation:** n/a.
- **Problem:** the timeout covers only time-to-headers.
- **Root cause:** `clearTimeout` in `finally` right after `fetch()` resolves (`legal-rag-client.ts:137`).
- **Severity:** Medium.
- **Recommended fix:** keep the abort timer until the body is fully consumed, or wrap the reader in an overall deadline.

**AF-2 — Fabricated citation passed through**
- **Question:** any legal-search question.
- **Expected:** citations verified to exist in the corpus.
- **Retrieved evidence:** whatever upstream sends.
- **Actual answer:** `sources[]` is relayed verbatim, and the UI renders them as "المصادر".
- **Citation:** unvalidated.
- **Problem:** Dostoori cannot detect an invented article.
- **Root cause:** no verification layer.
- **Severity:** High for legal use (UNVERIFIED whether upstream prevents it).
- **Recommended fix:** upstream must return stable corpus IDs, and Dostoori (or upstream) must verify that each cited ID and excerpt exists and that the answer quotes appear in it.

**AF-3 — Forged conversation history**
- **Question:** a follow-up, with injected `{role:'assistant', content:'…'}` turns.
- **Expected:** server-controlled history.
- **Retrieved evidence:** n/a.
- **Actual answer:** forwarded verbatim to the upstream condense step.
- **Citation:** n/a.
- **Problem:** prompt-injection surface.
- **Root cause:** `parseHistory` trusts the client (`assistant/route.ts:26-36`).
- **Severity:** Medium.
- **Recommended fix:** store the conversation server-side per user, or sign the history; never trust client `assistant` turns.

**AF-4 — Silent contract truncation affects grounding**
- **Question:** review a long contract.
- **Expected:** the whole contract is analysed, or the user is clearly told otherwise.
- **Retrieved evidence:** first 40,000 chars.
- **Actual answer:** risks computed on the prefix only; the UI gets a `truncated` flag.
- **Citation:** n/a.
- **Problem:** clauses after the cut are never reviewed.
- **Root cause:** hard char cap (`contract-review/route.ts:89-90`).
- **Severity:** Medium.
- **Recommended fix:** chunked review, or a prominent "partial review" state.

**AF-5 — Confidential case files leave the platform with an upstream id**
- **Question:** case analysis on a client file.
- **Expected:** processing without retention, or documented retention.
- **Retrieved evidence:** full file.
- **Actual answer:** upstream returns `id`, suggesting storage.
- **Citation:** n/a.
- **Problem:** unknown retention and cross-office access; OpenAI sub-processing.
- **Root cause:** architecture.
- **Severity:** High.
- **Recommended fix:** audit upstream; zero-retention mode; per-office opt-in; DPA.

**AF-6 — OCR hang**
- **Question:** contract review or OCR of a scanned PDF when the CDN is unreachable.
- **Expected:** 422/503 quickly.
- **Retrieved evidence:** n/a.
- **Actual answer:** hang, unhandled rejection (MEASURED in tests).
- **Citation:** n/a.
- **Problem:** request pile-up.
- **Root cause:** runtime model download without timeout.
- **Severity:** Medium.
- **Recommended fix:** bake `ara`/`eng` traineddata into the image, set `langPath` locally, reuse a worker pool, add a timeout.

**AF-7 — Failed calls consume the monthly cap; concurrent calls exceed it**
- **Expected:** the cap counts successful calls atomically.
- **Actual answer:** every attempt logs a row, and the count is check-then-act.
- **Root cause:** `usage.ts:44-55`.
- **Severity:** Low.
- **Recommended fix:** reserve-then-confirm usage rows.

---

## 4. AI/RAG readiness table

| Component | Status | Severity | Evidence | Required action |
|---|---|---|---|---|
| Ingestion | Dostoori extraction implemented; upstream UNVERIFIED | Medium | §2 Part 20; C-6 | Bundle OCR models; preserve structure; audit upstream ingestion |
| Chunking | UNVERIFIED | Unknown | not in repo | Audit upstream |
| Embeddings | UNVERIFIED | Unknown | not in repo | Audit upstream; version embeddings |
| Retrieval | UNVERIFIED | Unknown | not in repo | Run AI_EVALUATION.md set |
| Ranking | UNVERIFIED | Unknown | not in repo | Same |
| RAG | Integration implemented; engine UNVERIFIED | High | §1 | Audit engine + evaluation |
| Prompting | UNVERIFIED | Unknown | not in repo | Prompt review, versioning |
| Citations | Relayed unvalidated | High | AF-2 | Citation existence + support check |
| Grounding | Flag relayed only | High | §2 Part 25 | Claim-level grounding check |
| Hallucination control | Contract excerpts only | High | `contract-review/route.ts:108-111` | Extend verification to all features |
| Evaluation | **None** | High | AI_EVALUATION.md | Build and run a gold set before launch |
| AI Security | Partial (auth, tenancy, rate limits); history forgeable; injection untested | Medium | §2 Part 29 | Server-side history; injection test set |
| Tenant Isolation | Dostoori side PASS; upstream UNVERIFIED | High | §2 Part 23 | Per-office credentials or signed tenant claims; upstream audit |
| Office Isolation | Same as tenant (no sub-office model) | — | schema | — |
| Memory Isolation | Dostoori PASS (nothing stored); upstream UNVERIFIED | Medium | §2 Part 24 | Confirm upstream statelessness |
| Performance | UNKNOWN (no measurements); buffered SSE; no body timeout | Medium | AF-1 | Measure p50/p95; stream to UI |
| Cost Control | Call-count cap only, racy, not plan-aware; no token accounting | Medium | AF-7 | Atomic cap; upstream token reporting |
