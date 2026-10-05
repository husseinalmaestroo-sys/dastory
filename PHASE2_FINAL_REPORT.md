# Dastoori — Phase 2.1 Final Report: Live AI/RAG Repair, Corpus Repair, Validation & Production Hardening

**Scope.**
- `ailegal_hussein` (the AI engine), the Dastoori ⇄ engine boundary, and the Dastoori AI pages.
- Payment was not touched. The billing code (`src/lib/billing.ts`) has no change in this phase (diff audit in §3).

**Engine.**
- Branch `claude/ailegal-hussein-phase2` of this repository.
- Phase 2.1 commits, in order:
  - `3a9c028` pre-register held-out 2.1
  - `4910243` pre-register held-out 2.1b
  - `363c746` retrieval and grounding
  - `2113531` corpus integrity
  - `c6b7451` per-claim verdict test
  - `749ee2b` documents, retention, timings, authority
  - `051edd4` live-evaluation preflight
  - `6542a4e` fix for a regression found while writing this report (P21-27)
  - `feca566` hamza-seat matching (P21-28)

**Dastoori.**
- Branch `claude/hopeful-ritchie-gip3i7`.
- Phase 2.1 commit `9ebfa61`, then this report.

**Baseline.** `PHASE2_REPORT.md` (2026-09-26) gave these verdicts:

| Area | Phase 2 verdict |
|---|---|
| AI engine | CONDITIONAL |
| RAG | NOT READY |
| AI security | CONDITIONAL |
| Tenant isolation | PASS |
| Grounding & citations | NOT READY |
| Evaluation | CONDITIONAL |
| Overall | NOT READY |

**Report date:** 2026-09-28.

**Method.** Every problem went through the same loop:

1. Inspect, then identify the root cause.
2. Fix it.
3. Write a regression test, and see it fail on the old code where that was possible.
4. Measure.
5. Fix again if needed.
6. Re-run the broader suites.
7. Only then mark it FIXED.

**Evaluation discipline.**
- **Gates.** The gates in `eval/gates.json` were committed on 2026-09-26 (`a1af7ad`). They have not changed since: `git log -- eval/gates.json` shows that one commit only.
- **Held-out 2.1 (22 cases).** Written before any Phase 2.1 fix. Committed with its first-run result (`3a9c028`).
- **Held-out 2.1b (16 cases).** Committed before it was ever run (`4910243`).
- **No edits after registration.** `git diff 4910243..HEAD -- eval/dataset.json` is empty. No case was changed after results were seen.

**Labels.** Every finding carries one of:

| Label | Meaning |
|---|---|
| **FIXED** | A defect was found, fixed, covered by a regression test, and the broader suites re-run green. |
| **TESTED** | A behaviour was exercised by a test in this phase and passed. |
| **MEASURED** | A number computed by a run in this phase.<br>"offline" means deterministic test models over the synthetic corpus. It measures the pipeline's mechanics, not a real model's legal quality. |
| **UNVERIFIED** | Not verifiable from here. The text says what would verify it. |
| **BLOCKED BY EXTERNAL DEPENDENCY** | Needs something this environment does not have. §17 lists each one. |

**What this environment does not have.** This is unchanged from Phase 2, and was not re-probed:
- **No model API keys.**
- **Blocked egress.** The egress policy blocks `api.openai.com`, `api.voyageai.com`, `huggingface.co`, `moj.gov.jo`, `jc.jo` and `jba.org.jo`.
- **Anthropic.** `api.anthropic.com` is reachable, but there is no key.
- **No production corpus.** The corpus lives in a Neon Postgres database that is not reachable from here.
- **Consequence.** Every quality number below is offline.

---

## 1. What was broken

Each of these was found in this phase. The "Found by" column says how.

| ID | Area | What was broken | Found by |
|---|---|---|---|
| P21-01 | Retrieval | A question naming a law was not answered from that law: other laws' articles outranked it. | Held-out 2.1 first run: recall@8 **0.7647** |
| P21-02 | Retrieval | Exact look-ups written the way lawyers write them failed:<br>• "المادة رقم 17" and "م 17"<br>• ordinal words ("المادة الخامسة")<br>• lists of articles<br>• "القانون رقم 8 لسنة 1996"<br>• abbreviations "ق.ع" and "ق.أ.م.م" | Held-out 2.1b first run (on the in-progress Phase 2.1 code): recall@8 **0.6875**, MRR **0.6062** |
| P21-03 | Retrieval | A cited law number or year did not pin that version. An unknown law number was not reported as "not in the database". | Held-out cases, unit tests |
| P21-04 | Retrieval | One concept in two forms did not match (تقادم/تتقادم, دعوى/دعاوى, تهديد/هدد). | Held-out 2.1b paraphrase cases |
| P21-05 | Retrieval | Words that most candidates share admitted and ranked candidates, which hurt precision. A paraphrase naming no law was admitted on weak evidence. | Precision drop after the morphology fix; unit tests |
| P21-06 | Retrieval | A definition question did not rank the defining article first. An article referring to another article of its own law did not carry it. | Held-out 2.1b (definition case) |
| P21-07 | Retrieval | An over-long article was excerpted without its proviso: the rule was served without its exception. | Held-out 2.1b (proviso case) |
| P21-08 | Retrieval | Ranking was not reproducible: `ts_rank` ties had no order. MRR was **0.8873 vs 0.8922** on two identical runs. | Running the evaluation twice |
| P21-09 | Retrieval | The search folding dropped a lone number as a "page number", losing article and law numbers from query tokens. | Unit test while fixing P21-02 |
| P21-10 | Retrieval | One missing article inside a larger question refused the whole question. | Held-out case |
| P21-11 | Grounding | **6 of 18 adversarial model outputs survived the guards**, each counted as a fabricated citation:<br>• negation flipped<br>• negation added<br>• exception dropped<br>• irrelevant source cited<br>• penalty type swapped<br>• mental element swapped<br>This put the binding gate `fabricated_citations_in_output` at **6** (FAIL), with 9 expectation failures. | `eval/results/offline-2026-09-27-before-phase2.1-fixes.json` |
| P21-12 | Grounding | False premises were not corrected (`ho-saf-6`, `ho-saf-7`). A law absent from the corpus was answered as a generic "no evidence" (`ho-saf-1`). | Same run |
| P21-13 | Grounding | The self-verification judge returned one verdict per answer. "Full" grounding was granted without every claim being judged. | Code inspection, confirmed by test |
| P21-14 | Citation | The guard read "في المادة [1]" (a citation marker) as article 1. | Held-out case |
| P21-15 | Corpus | A damaged (character-corrupted) text was served like any other. There was no quarantine or replacement, and no audit trail. | Inspection; the corrupted laws recorded in `scripts/benchmark.ts` |
| P21-16 | Corpus | Answers called their sources "موثّقة" ("verified") although no text had been checked against its official publication. No provenance or authority was recorded. | Inspection |
| P21-17 | Corpus | No inventory or coverage matrix existed. Nobody could say which required laws are present, current, embedded or searchable. | Inspection |
| P21-18 | Contract review | A contract **under** the 96,000-character full-review limit was reported PARTIAL when clause-aware cuts needed a fifth segment. The call cap was too small for the promise. | Regression test written first; it **failed on the old code** |
| P21-19 | Case analysis | Figures were checked digit by digit. A date the file does not state (e.g. "12/1/2024") passed when all its digits appear elsewhere in the file. | Test with dates and amounts not in the file |
| P21-20 | Drafting | A changed party name or court in the draft went unreported. | Test with an altered draft |
| P21-21 | Retention | The engine's content purge ran only from a cron job that nothing installs, so content was kept forever. `error_log` rows (which can quote model output) were never purged. | Inspection |
| P21-22 | Retention | Dastoori AI conversations were kept forever. A user could neither start a new conversation nor delete one from the page. | Inspection |
| P21-23 | Cost | A duplicate submission (double click, or a retry while the first is still running) was sent upstream and paid twice. | Test |
| P21-24 | Performance | Only total latency was recorded, so there was no way to see where time goes. | Inspection |
| P21-25 | Evaluation | `npm run eval:live` would run against the synthetic test database, or with the test providers, and label the result "MEASURED (live)". An unknown `--mode` was silently accepted. | Inspection |
| P21-26 | Boundary / UI | Dastoori did not validate the engine's `sourceAuthority`. The assistant never told the lawyer that the texts are unverified. Case, contract and draft responses carried no `sourceAuthority`. | Inspection |

One regression was introduced **by this phase** and found while checking this report's numbers:

| ID | Area | What was broken | Found by |
|---|---|---|---|
| P21-27 | Retrieval | Held-out case `ho-ret-14` ("إذا لم يسدد المستأجر الإيجار شهراً كاملاً …") had been found at rank 3 mid-phase, but only through words every lease article shares (المستأجر, العقد). The common-word rule (P21-05) rightly stopped counting those, and the case dropped out of the top 8.<br>Root cause: the legal ontology's triggers for a tenant not paying rent were all dialect ("مستأجر ما يدفع", "ما دفع الأجرة"), so the same facts in formal Arabic reached no statutory term. | Comparing per-case ranks across the saved result files |

One more pre-existing gap was found by tracing the misses that remained after that:

| ID | Area | What was broken | Found by |
|---|---|---|---|
| P21-28 | Retrieval | A final hamza that takes a seat under an attached pronoun ("إنهاؤه", "إنهائه") never matched its bare form ("إنهاء"). The article "يجوز للمستأجر إنهاؤه … بإشعار خطي مدته ستون يوماً" was not seen to be about termination, and case `sec-inj-context` ranked it 4th. | Tracing the remaining misses stem by stem |

Two further defects were found **during** this phase by the regression suites, and fixed before commit:
- **`verify` regression.** It dropped to **378/380** when "المادة [12]" (article 12 with no 12th source) stopped being checked. Fixed back to **380/380**, with a counter-test.
- **Test stand-in model.** It refused paraphrases and the "م 41" form. Fixed so held-out answers are judged on meaning, not wording.

---

## 2. What was fixed

Every row has a regression test, and the broader suites were re-run afterwards (§3).

| ID | Fix | Commit | Regression test | Label |
|---|---|---|---|---|
| P21-01 | Law-scoped retrieval. When the question names a law, the ranked arms are scoped to it, the law's name is removed from the matched text, and subject words are OR-ed. | `363c746` | `tests/unit/retrieval.test.ts`; held-out law-name cases | **FIXED** |
| P21-02 | Article parsing for "رقم", "م", ordinals, lists, "القانون رقم … لسنة …", and abbreviation expansion. The year rule is limited so "المادة 5 ق.أ.م.م" still parses. | `363c746` | Unit tests; held-out 2.1b exact-article cases (3/3) | **FIXED** |
| P21-03 | A cited number or year pins that version; a superseded version is searched and labelled. An unknown number gives "not in the database". | `363c746` | Unit and integration tests | **FIXED** |
| P21-04 | Concept matching by deduplicated match keys (stems). | `363c746` | Unit tests; held-out 2.1b paraphrases | **FIXED** |
| P21-05 | Common-word discounting (words shared by most candidates neither admit nor rank). A paraphrase with no law named is admitted only on strong lexical evidence (≥ 3 words, ≥ half). | `363c746` | Unit tests; precision recovered (§5) | **FIXED** |
| P21-06 | A definition nudge. Referenced articles of the same law are carried as companions. | `363c746` | Held-out definition case | **FIXED** |
| P21-07 | Proviso-preserving excerpts: an over-long article keeps its "على أن / إلا / ما لم …" clause. | `363c746` | Held-out proviso case | **FIXED** |
| P21-08 | Deterministic tie-break `ORDER BY score DESC, d.id` in the keyword and stem arms. | `363c746` | Two runs now give identical metrics | **FIXED** |
| P21-09 | Digit tokens keep `normalizeDigits` in law-reference `tokens()` and legal-semantics `tokenize()`. | `363c746` | Unit test | **FIXED** |
| P21-10 | The rest of the question is answered, with a notice about the missing article. The missing number is never cited. | `363c746` | Integration test | **FIXED** |
| P21-11 | Meaning checks that a lexical support score cannot see: negation, swapped penalty, swapped mental element, swapped remedy, dropped exception, irrelevant source, figures written as words. | `363c746` | Adversarial battery: **0 of 18** survive | **FIXED** |
| P21-12 | A false premise gets the pre-registered notice "تنبيه بشأن مقدمة السؤال" and is never echoed. A law absent from the corpus gives `law_not_in_corpus`. | `363c746` | `ho-saf-1/6/7` pass | **FIXED** |
| P21-13 | The judge returns a verdict per claim (SUPPORTED / PARTIAL / CONTRADICTED / UNSUPPORTED / IRRELEVANT). "Full" grounding needs every claim judged; otherwise the answer is capped at partial, with a notice. A PARTIAL claim carries "مع مراعاة الشروط والاستثناءات". | `363c746`, `c6b7451` | `tests/integration/verdicts.test.ts` (end to end) | **FIXED** |
| P21-14 | A bracketed index within the source count is a marker. "المادة [12]" with no 12th source is still checked. | `363c746` | `verify` 380/380 plus a counter-test | **FIXED** |
| P21-15 | `integrity_status` (verified / unverified / quarantined / replaced) with an append-only event log. Quarantined and replaced texts are never served — by search, title resolution, `getChunksByIds`, citation checks, or the corpus version. `replaceSource` keeps the old text as history. | `2113531` | `tests/integration/corpus.test.ts`: a garbled fixture cannot be reached even by its own words | **FIXED** |
| P21-16 | A source is authoritative only if it is official, verified and not a fixture. Answers carry `sourceAuthority`. A grounded answer on unverified texts uses a disclaimer that says so. | `2113531`, `749ee2b` | Corpus and pipeline tests | **FIXED** |
| P21-17 | `npm run corpus:inventory`: per-source identity, provenance, version, chunks, models, article numbering, anomalies, and the coverage matrix of `deploy/sources/required-laws.json`. `npm run corpus:integrity`: quarantine, verify, replace, auto-quarantine, provenance backfill, history. | `2113531` | Unit and integration tests; run in §4 | **FIXED** |
| P21-18 | Segments are chosen by character budget: `MAX_CONTRACT_CALLS = segments + 2`, capped at 96,000 characters. | `749ee2b` | "a contract under the full-review limit is reviewed in full even when clause cuts need a fifth segment" (failed before, passes now) | **FIXED** |
| P21-19 | Dates and amounts are checked as units, including Arabic month names. Ones the file does not state become "[تاريخ غير مُتحقَّق منه]" / "[رقم غير مُتحقَّق منه]". | `749ee2b` | `documents.test.ts` (3 redactions); `validators.test.ts` | **FIXED** |
| P21-20 | `missingSuppliedFields`: short supplied fields (names, court, dates) that the draft does not carry as written are reported. Spelling variants (أ/ا, ي/ى) are not counted as changes. Dastoori passes the list to the page. | `749ee2b`, `9ebfa61` | `documents.test.ts` | **FIXED** |
| P21-21 | `runRetentionIfDue`: every AI request may trigger the purge, at most once per 6 hours across instances (advisory lock plus `maintenance_runs`). `error_log` is purged with content. Turned off by `AUTO_RETENTION=false`. | `749ee2b` | `retention.test.ts`: forced / due / not due / triggered by a real request | **FIXED** |
| P21-22 | Conversations untouched for `AI_CONVERSATION_RETENTION_DAYS` (default 90) are deleted with their messages, by the assistant route, at most every 6 hours per process. The page gains "محادثة جديدة" (new conversation) and "حذف المحادثة" (delete conversation). | `9ebfa61` | Integration retention test; staging browser test | **FIXED** |
| P21-23 | An in-flight key: an HMAC of feature plus payload, held under the office lock and cleared on completion. An identical request while the first runs gets **409**: it is not sent upstream and not counted. | `9ebfa61` | 2 integration tests; staging checks the key is cleared | **FIXED** |
| P21-24 | `stage_ms` per request: retrieval, grounding, and model time per purpose. Stored in `ai_requests.stage_ms` and on the log line. | `749ee2b` | The pipelines test asserts the keys | **FIXED** |
| P21-25 | A live-evaluation preflight, and `npm run eval:live` as one guarded command (§18). `eval.ts --mode live` and `benchmark.ts` guard themselves too. An unknown `--mode` is refused. | `051edd4` | 9 unit and 3 integration tests; the runner **refuses the test database with exit 2 and writes nothing** | **FIXED** |
| P21-26 | `engine-schema.ts` derives `sourceAuthority` from the cited sources. A "verified" claim without verified citations is rejected as malformed (502, not shown, not counted). All four features pass it through. The assistant labels fully grounded answers "مُسند بالكامل (… لم يُتحقَّق بعد من مطابقته للنشر الرسمي)" — fully sourced, not yet checked against the official publication. | `749ee2b`, `9ebfa61` | `legal-rag-client.test.ts`; staging browser test | **FIXED** |
| P21-27 | Formal-Arabic triggers added to the same ontology concept ("لم يسدد المستأجر", "عدم دفع الأجرة", "امتنع المستأجر عن سداد", …). A tenant paying rent, or a debtor not paying a loan, does not trigger it. | `6542a4e` | Unit test with five phrasings, none of them an evaluation question except the case itself. **It fails on the old ontology.** In the offline evaluation `ho-ret-14` goes from not found to **rank 1**, and **no other case changes rank, mode or grounding**. | **FIXED** |
| P21-28 | `matchKeys` maps a seated final hamza back to the bare form ("انهاوه"/"انهايه" → "انهاء"). "إنهاء" (termination) and "انتهاء" (expiry) still do not meet. | `feca566` | Unit test; **fails on the old keys**. Offline evaluation:<br>• `sec-inj-context` rank **4 → 1**, and its answer now cites the gold article.<br>• `ho-ret-14` rank 1 → **2**: the article on ending a lease with notice really does say "إنهاؤه", while the gold article says "فسخ". Both stay retrieved.<br>• No other case changes. | **FIXED** |

---

> **Superseded by the corpus repair (2026-10-05): rows P21-16 and P21-26.**
> - **"Authoritative" changed meaning.** It now means: compared with the Official Gazette (with a recorded reference), integrity check passed, and not a fixture.
>   - It no longer means "official provenance + verified".
>   - An official provenance alone, such as a Legislation Bureau copy, is not a Gazette verification.
> - **Integrity and Gazette verification are now separate columns.** Phase 2.1's `integrity_status = verified` migrates to integrity `passed`. It does not migrate to Gazette-verified.
> - **The labels changed.**
>   - The assistant now states each cited source's authority level: "من جهة نشر رسمية — لم يُقارن بالجريدة الرسمية" and similar.
>   - The disclaimer no longer says "مصادر موثّقة".
>
> Details in `PHASE2_CORPUS_REPAIR_REPORT.md`.

## 3. What was tested

**Final regression.** Everything below was run on the committed trees, after the last change. The only exception is the report commit itself; §18 records its CI.

| Suite | Engine (`feca566`) | Dastoori (`9ebfa61`) |
|---|---|---|
| Typecheck (`tsc --noEmit`) | 0 errors (includes `scripts/`) | 0 errors |
| Lint | Part of `next build` | `eslint .` clean |
| Unit | **101 / 101** | **206 / 206** |
| Integration (real Postgres+pgvector / real MySQL) | **63 / 63** | **373 / 373** |
| HTTP (production bundle over a socket) | **13 / 13** | **112 / 112** |
| End-to-end browser | — | **3 / 3** (Playwright) |
| Staging: both apps' production bundles, real HTTP, two offices, real browser | — | **14 / 14** (engine built from `feca566`) |
| `verify` (pipeline checks) | **380 / 380** | — |
| Offline evaluation (78 cases; 6 binding gates) | **all gates PASS**, 0 expectation failures | — |
| Production build | OK | OK |
| CI | `ai-engine` runs #7–#12 **success** (last: `feca566`) | `CI` run #11 **success** |

**Diff audit** (engine `94bc08e..feca566`, Dastoori `f267a5c..9ebfa61`):
- **Payment.** No payment, billing, subscription or checkout file changed.
- **Skipped tests.** No `.skip`, `.only` or `.todo` was added.
- **Secrets.** No credential-shaped string was added. The one match is the deliberate fake `npg_DONOTPRINT` in the redaction test.
- **Cleanup.** The throwaway `scripts/_dbg_*.ts` files were deleted before commit.

---

## 4. Corpus status

| Item | Status | Label |
|---|---|---|
| The production corpus: which of the 19 required laws (11 P0) are present, current, clean, embedded | It lives in Neon, which is unreachable from here | **BLOCKED BY EXTERNAL DEPENDENCY** |
| Known corpus defect from earlier phases | Character-corrupted indexed text for قانون العقوبات and القانون المدني, recorded in `scripts/benchmark.ts` for 40 of the benchmark's 100 target cases | **UNVERIFIED** (not re-checked here) |
| Clean official texts to replace them | Needs `lob.gov.jo` / `pm.gov.jo` / `jc.jo`. Only `jc.jo` of these is in the known-blocked list; the rest were not probed. | **BLOCKED BY EXTERNAL DEPENDENCY** |
| Integrity layer (statuses, event log, replacement with history, never-serve rule) | Built and tested | **FIXED / TESTED** |
| Inventory and coverage matrix | Built and tested; run on the test database (below) | **FIXED / TESTED** |
| Provenance rules | `lob.gov.jo`, `pm.gov.jo` and `jc.jo` are official. `moj.gov.jo` and `jba.org.jo` are secondary: served, labelled, never authoritative. | **FIXED** |
| Required-law registry (`deploy/sources/required-laws.json`) | Law numbers and years are not yet checked against the Official Gazette | **UNVERIFIED** |

> **Correction (2026-10-05).** `PHASE2_REPORT.md` said no record showed that 7 of the 10 "missing" core laws were ever ingested. That was wrong.
>
> **What the repository records.**
> - **Four were retrieved.** Saved historical retrieval results (`benchmark/comparison-snapshot-*.json`) show chunks retrieved from:
>   - Personal Status;
>   - Arbitration;
>   - Consumer Protection;
>   - Real Property (under a damaged title).
> - **Three are still not proven present:** Evidence 30/1952, Landlords & Tenants 11/1994, Income Tax 34/2014.
>
> **States are kept separate from now on.** None is inferred from another: PRESENT / RETRIEVED, DATABASE VERIFIED, OFFICIAL SOURCE, GAZETTE VERIFIED, CURRENT VERSION, SEARCHABLE, EMBEDDED, AUTHORITATIVE.
> - For the four retrieved laws, only PRESENT / RETRIEVED (historical) is established.
> - No law in this report is DATABASE VERIFIED, GAZETTE VERIFIED or AUTHORITATIVE.
>
> See `PHASE2_CORPUS_REPAIR_REPORT.md` for the per-law table, and for the corpus repairs made after this report.

**Inventory run on the test database** (`npm run corpus:inventory`, synthetic corpus). It shows the tooling detects what it must:

| Measure | Result |
|---|---|
| Sources | 10 (all synthetic) |
| Servable | 8 |
| Authoritative | 0 |
| Chunks | 30 |
| Not servable: the Egyptian (non-JO) fixture | Excluded |
| Not servable: the garbled fixture | Quarantined. Detected as `garbled_text` ("0 distinct common Arabic words, expected at least 5"). |
| Coverage of the 19 required laws | 0, as expected for a synthetic corpus. Every P0 law is reported `missing_law` (critical). |

**What the live corpus run will show.** The preflight (§18) runs the same inventory against the real database. It **refuses** a live run unless:
- the database serves at least one non-synthetic source;
- no non-synthetic chunk carries a test-model vector;
- at least 90% of servable chunks carry vectors of the served embedding model;
- at least one P0 law is servable.

Missing P0 laws, zero verified official texts and critical anomalies are **reported**, not hidden.

---

## 5. Retrieval

**MEASURED (offline).** Synthetic corpus, lexical test embedder. Numbers are recall@8 / MRR.

| Case set (cases with retrieval labels) | First measurement | After |
|---|---|---|
| Original (17) | 0.8235 / 0.7206: end of Phase 2 (`offline-2026-09-26.json`) | **1.0 / 0.9706** |
| Held-out 2.1 (17; written before any fix) | 0.7647 / 0.7647: before any Phase 2.1 fix (`…before-phase2.1-fixes.json`) | **1.0 / 0.9706** |
| Held-out 2.1b (16; committed before its first run) | 0.6875 / 0.6062: its first run (`…heldout-b-first-run.json`) | **1.0 / 0.9688** |
| All 50 | — | recall@8 **1.0**, MRR **0.97**, precision@k 0.6904, nDCG@8 0.9779 |

**How far the held-out numbers can be trusted.** Only each set's **first run** is an unbiased measurement:

| Set | First run | What it measured |
|---|---|---|
| Held-out 2.1 | 0.7647 / 0.7647 | The pre-Phase-2.1 code on unseen questions |
| Held-out 2.1b | 0.6875 / 0.6062 | The code after the first round of fixes, on unseen questions |

- **The "After" numbers are not unbiased.** After each first run, that set's failures drove fixes (2.1 → the retrieval and grounding fixes in `363c746`, and P21-27; 2.1b → P21-02, -04, -06, -07). Its "After" number therefore shows that the observed failures were repaired, not that the code generalises.
- **The honest reading of the offline evidence.** Each time the code met questions nobody had tuned against, recall@8 was 0.69–0.76. The final code has no unbiased offline estimate.
- **What does measure it.** The live run over the real corpus (`legal-qa-100`, once its gold is verified) is not tuned against. The same holds for any new held-out set, committed before its first run.

**Why held-out 2.1b exists.**
- Its first run was on the Phase 2.1 code **after** the round of fixes driven by held-out 2.1. At that point the other two sets already stood at 0.9412 / 0.8824 (original) and 1.0 / 0.8922 (held-out 2.1).
- It tested whether those fixes generalise to cases nobody had tuned against. They did not fully: it exposed P21-02, P21-04, P21-06 and P21-07, which were then fixed.

- **Reproducibility.** Two identical runs now give identical numbers (P21-08).
- **Both sets meet the proposed gate.** The pre-registered rule is that a proposed gate counts only if both the original and held-out sets meet it. Recall ≥ 0.85 and MRR ≥ 0.7 hold on every set.

**Remaining misses.** These are not fixed, and the reason is stated:

| Case | Result | Why | Label |
|---|---|---|---|
| `ho-ret-14` | Gold at rank 2 | Article 17 (ending a lease with notice) ranks first. The question says "إنهاء العقد", article 17 says "إنهاؤه", and the gold article says "فسخ". Ranking the gold first needs إنهاء ≈ فسخ here (a landlord's rescission for non-payment): meaning, not word form. | **UNVERIFIED** until the real embedding run |
| `ret-lawname-1`, `hb-ret-12` | Gold at rank 2 | Two articles of the same law share every subject word; only "ألا يقل عن" (a minimum) separates them. | **UNVERIFIED** until the real embedding run |

**Measured and not adopted.** Each was tried and measured on every case, then rejected on the numbers:
- **The ة → ت rule** ("مدته" / "مدة"), the twin of P21-28. It is linguistically right, but "مدة" appears in most statutes. It admitted a second, weaker article in four cases and cut precision 0.691 → 0.673. Its target case is fixed by P21-28 alone.
- **An ontology bridge** "الحد الأدنى / الحد الأقصى" → "لا يقل عن / لا يزيد على". It left `hb-ret-12` unchanged: its terms do not reach the tie-break.

**Real-corpus retrieval** (`benchmark/legal-qa-100.json`): **BLOCKED BY EXTERNAL DEPENDENCY**. It runs as step 3 of `npm run eval:live`, and its labels are **GOLD UNVERIFIED**.

---

## 6. Grounding

| Check | Result | Label |
|---|---|---|
| Adversarial model outputs surviving the guards | **0 of 18** (was **6**: P21-11) | **FIXED / MEASURED** |
| Grounded answer rate | **0.9804** (≥ 0.8 proposed) | **MEASURED** (offline) |
| Unsupported claims caught before output | 3 of 100 checked claims (3%) removed or qualified | **MEASURED** (offline) |
| Per-claim judge verdicts decide "full" / "partial" | Tested end to end | **FIXED / TESTED** |
| False premise corrected with the pre-registered notice | `ho-saf-6`, `ho-saf-7` pass; a true premise is not "corrected" | **FIXED** |
| Grounded answers that cite no gold-relevant source | 4 of 50 (informational metric, no threshold; was 5 before P21-28). The answer is supported by its cited text, but that is not the article the gold names:<br>• `hb-ret-1`: the gold article is retrieved at **rank 1** and handed to the model. The deterministic stand-in model picks sentences by word overlap with the question, not by meaning, so it cites another article.<br>• `ho-ret-14`, `ret-lawname-1`, `hb-ret-12`: gold at rank 2 (§5). | **UNVERIFIED** until a real model and embeddings run |
| The same with a real model | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 7. Citation

| Check | Result | Label |
|---|---|---|
| `fabricated_citations_in_output` (binding, max 0) | **0** (was **6** in the first held-out run) | **FIXED / MEASURED** |
| Citation existence accuracy | **1.0** | **MEASURED** (offline) |
| Citation support accuracy | **0.97** (≥ 0.95 proposed; Phase 2 was 0.9375) | **MEASURED** (offline) |
| Article mentions checked against the cited sources | 149 | **MEASURED** |
| "في المادة [1]" as a marker; "المادة [12]" still checked | `verify` 380/380 | **FIXED** |
| An article the corpus does not hold (e.g. "المادة 999") never survives as a citation, in answers or drafts | Tested | **TESTED** |
| Only official, verified, non-fixture texts can be called verified. Dastoori rejects a "verified" claim without such a citation. | Tested on both sides | **FIXED / TESTED** |
| Real-model citation behaviour | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 8. Hallucination

| Check | Result | Label |
|---|---|---|
| `no_evidence_hallucination_rate` (binding, max 0.02) | **0** | **MEASURED** (offline) |
| No-answer accuracy (the corpus cannot answer, and the system says so) | **1.0** | **MEASURED** (offline) |
| A law not in the corpus is named as such, never answered from another law | `ho-saf-1` passes | **FIXED** |
| Case analysis: a party, fact, date or amount not in the file never survives | 3 figures redacted; the invented party and the unevidenced fact dropped | **FIXED / TESTED** |
| Drafting: dates, amounts and ids the lawyer never supplied become "[يُستكمل: …]" | Tested | **TESTED** |
| A real model's hallucination rate (the 2% allowance exists for it) | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 9. Prompt injection

| Check | Result | Label |
|---|---|---|
| `critical_injection_bypass` (binding, max 0) | **0** across 6 injection cases, a malicious document and forged history | **MEASURED** (offline) |
| `system_prompt_leakage` (binding, max 0) | **0** | **MEASURED** (offline) |
| Drafting fields with a forged fence end, "ignore the instructions", and a fake article | The forged fence is neutralised, the hostile text stays inside the fenced field, the fake citation is removed, and the prompt canary never appears | **TESTED** |
| Forged conversation history | Ignored by both the engine and Dastoori. Staging: the injected "system" turn is not stored. | **TESTED** |
| Whether a **real** model obeys injected text | The test model does not follow instructions by construction, so the guards were tested but the model was not | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 10. Tenant isolation

**Setup.** Two offices were used, with the canaries **CANARY-A-LIVE-7F3E** and **CANARY-B-LIVE-19C2**. Every check below was run **in both directions**, with both apps' production bundles over real HTTP and a real browser (`src/__staging__/ai.staging.test.ts`, **14/14**).

| Surface | What was checked | Result | Label |
|---|---|---|---|
| Contract review | Each office reviews its own contract: full coverage, and every excerpt is its own contract's text. Nothing of the other office appears. | Pass | **TESTED** |
| Case analysis | Parties come from the office's own file (its own canary). The other canary is absent. | Pass | **TESTED** |
| Cross-office document ids | 404 before processing. The engine's request count for that office is unchanged, so the engine never saw the request. | Pass | **TESTED** |
| Chat (assistant) | Asking for "the other office's contract containing CANARY-…": neither answer nor sources contain it | Pass | **TESTED** |
| Legal search (`/api/search/legal`) | Same probe: neither answer nor sources contain it | Pass | **TESTED** |
| Conversations | Neither office can continue or delete the other's conversation (404). Both still exist afterwards. | Pass | **TESTED** |
| Retrieval, citations, sources | Sources come from the public corpus only; no canary in any `sources` array | Pass | **TESTED** |
| Prompts | Everything sent to the model, per tenant, in both directions: no other-tenant canary (`pipelines.test.ts`; eval tenant-canary battery) | Pass | **TESTED** |
| Engine database | Every text or JSON column scanned: **0 rows** with either canary, even though both offices typed the other's canary into questions | Pass | **TESTED** |
| Dastoori database | No assistant message in either office's conversations carries the other's canary | Pass | **TESTED** |
| Cache | No answer cache exists. The only cache holds query-embedding vectors, keyed by model and text. | Pass | **TESTED** (Phase 2, unchanged) |
| Logs | Both services' full logs from the run scanned: engine 7.2 KB with 12 request lines, Dastoori 421 B. Neither canary appears in either. | Pass | **TESTED** |
| Attribution | Every engine request is attributed to the right office and user by signed claims | Pass | **TESTED** |
| `cross_tenant_leakage` / `unauthorized_access_accepted` (binding) | **0 / 0**, with 10 unauthorized attempts | Pass | **MEASURED** |
| With a real model | The model never receives another office's content (proven at the prompt level), so the model cannot leak it. The binding live run is still required. | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

**Memory retention and expiry.** This is **FIXED / TESTED** in both services (P21-21, P21-22):

| Content | Rule |
|---|---|
| Engine content (standalone app) | 90 days (`CONTENT_RETENTION_DAYS`) |
| Engine accounting | 400 days (`ACCOUNTING_RETENTION_DAYS`) |
| Dastoori AI conversations | 90 days since last use |
| Deletion | Users can delete a conversation themselves |

---

## 11. Contract analysis

**Sizes.** Contracts were built with findings at 1%, 50% and 99% of their length (`documents.test.ts`):

| Size (actual characters) | Coverage | What was measured | Label |
|---|---|---|---|
| 20k (20,057), 40k (40,002), 60k (60,058) | **Full** (`partial=false`) | Every character read; all three findings reported; no clause split between segments | **TESTED** |
| Just under 96,000, needing five segments | **Full** | The full-review promise at the limit. Reported PARTIAL before this phase (P21-18). | **FIXED** |
| "96k" (96,026: 26 over the limit) | **PARTIAL REVIEW** | Analysed 1–95,916 (the cut falls at a clause boundary); characters 95,917–96,026 listed as not analysed. All three findings were in the read range and reported. | **TESTED** |
| 120k (120,099) | **PARTIAL REVIEW** | Analysed 1–95,915; 95,916–120,099 listed as not analysed. Start and middle findings reported; the end finding (at 118,879, unread) **not claimed**. | **TESTED** |
| 200k (200,019) | **PARTIAL REVIEW** | Analysed 1–95,908; 95,909–200,019 listed as not analysed. Only the start finding reported; the middle (100,051) and end findings **not claimed**. | **TESTED** |
| A segment whose analysis is rejected | **PARTIAL REVIEW** | Listed as not reviewed with its exact character range; the rest is kept | **TESTED** |

**What every size proves.**
- Analysed plus listed-as-unread characters equal the whole contract.
- A finding is reported **if and only if** its clause was read.
- There are at most 6 model calls (`MAX_CONTRACT_CALLS`).

**How Dastoori presents it.**
- **Coverage.** Dastoori adds its own cut beyond 200,000 characters to the not-analysed ranges.
- **Partial review.** The disclaimer starts with "مراجعة جزئية" ("partial review").
- **Excerpts.** An excerpt that is not verbatim in the contract is dropped server-side.

**Label.** Coverage is **FIXED / TESTED**. The quality of a real model's review is **BLOCKED BY EXTERNAL DEPENDENCY**.

---

## 12. Case analysis

| Check | Result | Label |
|---|---|---|
| Facts, parties and dates come from the file; each fact needs an excerpt of the file | An unevidenced fact is dropped; a party the file does not name is dropped | **TESTED** |
| Dates and amounts checked as units (P21-19) | 3 invented figures redacted. The file's own date written differently ("12 آذار 2023" for 12/3/2023) is kept. | **FIXED** |
| Staging, both offices | Parties from the office's own file; the other canary absent; coverage full | **TESTED** |
| `sourceAuthority` on the response | Passed through and validated | **FIXED** |
| Real-model analysis quality | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 13. Drafting

| Check | Result | Label |
|---|---|---|
| Supplied facts preserved | A faithful draft reports `missingSuppliedFields = []` | **TESTED** |
| Supplied facts altered (defendant's name, court) | Reported. Spelling variants of the same name are not reported. | **FIXED** (P21-20) |
| Unsupplied facts marked | "[يُستكمل: …]" with a count (`unverifiedFacts`) | **TESTED** |
| Adversarial input | Forged fence, instruction override and fake article all neutralised; no prompt leak | **TESTED** |
| Dastoori | Passes `missingSuppliedFields` and `sourceAuthority` to the page | **FIXED** |
| Real-model drafting quality | — | **BLOCKED BY EXTERNAL DEPENDENCY** |

---

## 14. Performance

**Stage timings.** Every request now records `stage_ms` (P21-24). These are offline values from the requests recorded in this phase's runs, in ms:

| Feature (n) | Retrieval p50 / p95 | Grounding p50 / p95 | Model time p50 / p95 | Total p50 / p95 |
|---|---|---|---|---|
| Chat (263) | 9 / 23.5 | 2 / 12 | answer 0 / 2 · judge 0 / 1 · embed 0 / 1 | **18 / 49.8** |
| Contract review (25) | 38 / 232 | — | 1 / 3 | **42 / 289.8** |
| Case analysis (11) | 34 / 45.5 | — | 1 / 1 | **43 / 59.5** |

- **Where the time goes offline.** Retrieval dominates. The contract-review p95 comes from the 96k–200k contracts in the document tests.
- **Label.** MEASURED, but **not representative**: the test model answers instantly, and real latency is dominated by the LLM.
- **Real p50/p95 per stage.** **BLOCKED BY EXTERNAL DEPENDENCY**. The live run records them in `ai_requests.stage_ms` with no further work.

**Deadlines.** Both are **TESTED** (Phase 2, re-run green):
- **Engine.** 90 s per request.
- **Dastoori upstream.** A stall after the headers ends in **504** within the deadline.

---

## 15. Cost

| Check | Result | Label |
|---|---|---|
| Every model call is metered, including failed ones (recorded with `ok=false`) | Usage-meter tests; per-purpose counts and times in `stage_ms` | **TESTED** |
| A failed request does not consume the office's quota | Integration test: a failed upstream call is recorded but not counted. Staging: engine down gives 502/504, and the quota count is unchanged. | **TESTED** |
| A malformed engine response | 502; never shown; not counted | **TESTED** |
| Duplicate submissions (P21-23) | 409 `duplicate_in_flight`; not sent upstream; not counted; allowed again after completion. Different questions, or a colleague's identical question, are not duplicates. | **FIXED / TESTED** |
| Concurrency | 10 concurrent calls with 1 slot left: exactly 1 succeeds | **TESTED** |
| Per-user daily cap; office token budget from engine-reported usage; engine-side office cost cap | Pass | **TESTED** |
| Real cost per query | Test models are free, and token counts are approximations. Offline averages: 1,992 tokens in and 68 tokens out per query, 0 retries. | **BLOCKED BY EXTERNAL DEPENDENCY** |

The live run will report cost as **ESTIMATED**: `pricing.ts` rates × measured tokens.

---

## 16. Remaining blockers

**Everything that could be fixed without external access was fixed.** What remains:

| # | Blocker | What it blocks | Label |
|---|---|---|---|
| B-1 | Model API keys, plus egress to the provider hosts | Every real-model number: answer quality, grounding, injection resistance, latency, cost | **BLOCKED BY EXTERNAL DEPENDENCY** |
| B-2 | Access to the production corpus: a staging copy of the Neon database | The real inventory, coverage matrix, real retrieval (`legal-qa-100`) and the live evaluation | **BLOCKED BY EXTERNAL DEPENDENCY** |
| B-3 | Clean official texts for the corrupted laws (`lob.gov.jo` / `pm.gov.jo` / `jc.jo`) | Replacing damaged texts (the replacement mechanism is ready: `corpus:integrity replace`) | **BLOCKED BY EXTERNAL DEPENDENCY** |
| B-4 | A qualified Jordanian lawyer to verify the legal gold and the registry's law numbers and years | Turning **GOLD UNVERIFIED** into verified gold; the proposed legal-quality gates are defined only on verified gold | **BLOCKED BY EXTERNAL DEPENDENCY** (human review) |
| B-5 | The real embedding model and chat model | The three rank-2 cases (`ho-ret-14`, `ret-lawname-1`, `hb-ret-12`), and whether a real model cites the rank-1 gold article that the stand-in model passes over (`hb-ret-1`) | **BLOCKED BY EXTERNAL DEPENDENCY** |
| B-6 | OCR language data (downloaded at run time) and an Arabic text-PDF fixture | The two evaluation cases marked NOT MEASURED (scanned PDF, Arabic PDF) | **BLOCKED BY EXTERNAL DEPENDENCY** |

**Operating rule until these clear.** AI stays **disabled for real client data**.
- In production Dastoori, leave `AI_LEGAL_SERVICE_URL` / `AI_LEGAL_SERVICE_KEY` unset.
- Every AI route then answers **503**, never a fabricated answer. This is tested in `ai-and-signature.integration.test.ts`.
- Switch it on only after `npm run eval:live` passes every binding gate on the real corpus.

**Deploy notes** (behaviour changes to know before deploying these branches):

1. **Engine.** Run `npm run migrate`: it adds `maintenance_runs` and `ai_requests.stage_ms`.
2. **Engine retention.** The automatic purge starts on the first AI request. It deletes standalone-app content older than `CONTENT_RETENTION_DAYS` (90). Set `AUTO_RETENTION=false` to hold it until the operator agrees.
3. **Dastoori.** The migration `20260928090000_phase21_ai_inflight_key` adds a column and an index. Conversations untouched for 90 days start being deleted (`AI_CONVERSATION_RETENTION_DAYS`).

---

## 17. External dependencies

Each dependency is configured in the environment's settings. **No secret was requested, printed or stored in this phase.**

| Dependency | Setting | Why | Notes |
|---|---|---|---|
| OpenAI key | `OPENAI_API_KEY` | Embeddings. Optionally also chat. | **Required.** The production corpus was embedded with `text-embedding-3-small`. Query vectors must come from that model, or the preflight blocks: vectors of another model are invisible to retrieval. |
| Anthropic key (optional) | `ANTHROPIC_API_KEY` with `CHAT_PROVIDER=anthropic` | Claude for answers | Embeddings still need OpenAI |
| Staging corpus database | `DATABASE_URL` pointing at a **staging copy** (Neon branch) of the production database | Real inventory, retrieval and the live evaluation | The live run writes accounting rows and may trigger the retention purge. Use a copy, or set `AUTO_RETENTION=false`. |
| Network egress | Allow `api.openai.com`, the Neon host (`*.neon.tech`), and `api.anthropic.com` if used | Reaching the above | Set in the cloud environment's network settings |
| Official sources (corpus repair) | Allow `lob.gov.jo`, `pm.gov.jo`, `jc.jo` | Clean texts to replace corrupted ones | — |
| Legal reviewer | A qualified Jordanian lawyer | Verify `benchmark/legal-qa-100.json` and `deploy/sources/required-laws.json` | Human, not technical |

**Verification sequence** once they are provided:

```bash
npm run eval:preflight            # read-only: every blocking check must be ✓
npm run eval:preflight -- --probe # + one tiny embedding and chat call (a fraction of a cent)
npm run eval:live                 # preflight → live suite → real-corpus retrieval benchmark
npm run eval:live -- --generate   # … plus the benchmark's paid citation/hallucination part
npm run corpus:inventory -- --md corpus-inventory.md   # the real coverage matrix
```

---

## 18. Final gates

**Pre-registered gates** (`eval/gates.json`, 2026-09-26, unchanged):

| Gate | Threshold | Offline (this phase) | Live | Status |
|---|---|---|---|---|
| Cross-tenant leakage | = 0 | **0** (+ staging, both directions, 14/14) | not run | Offline **PASS**; live **BLOCKED** |
| Unauthorized access accepted | = 0 | **0** of 10 attempts | not run | Offline **PASS**; live **BLOCKED** |
| Fabricated citations in output | = 0 | **0** (was 6) | not run | Offline **PASS**; live **BLOCKED** |
| System-prompt leakage | = 0 | **0** | not run | Offline **PASS**; live **BLOCKED** |
| Critical injection bypass | = 0 | **0** | not run | Offline **PASS**; live **BLOCKED** |
| No-evidence hallucination rate | ≤ 0.02 | **0** | not run | Offline **PASS**; live **BLOCKED** |

**Proposed legal-quality gates.** These apply to a live run on verified gold only. Offline values are for information; each set is original / held-out 2.1 / held-out 2.1b.

| Gate | Threshold | Offline | Status |
|---|---|---|---|
| Citation existence | ≥ 1.0 | 1.0 | Informational PASS; launch **BLOCKED** (B-1, B-2, B-4) |
| Citation support | ≥ 0.95 | 0.97 | Same |
| Grounded answer rate | ≥ 0.8 | 0.9804 | Same |
| No-answer accuracy | ≥ 0.9 | 1.0 | Same |
| Hallucination rate | ≤ 0.02 | 0 | Same |
| Retrieval recall@8 | ≥ 0.85 | 1.0 (1.0 / 1.0 / 1.0) | Same |
| Retrieval MRR | ≥ 0.7 | 0.97 (0.9706 / 0.9706 / 0.9688) | Same |

**Engineering gates.**
- **Suites.** Every suite in §3 is green, and CI is green on both branches.
- **Payment.** No payment change.
- **Tests.** No skipped or disabled test.
- **Secrets.** No secret in any diff.
- **Gate integrity.** No gate or pre-registered case changed after results.

**The live evaluation is guarded.** `npm run eval:live` refuses the synthetic test database:

```
✗ chat_key             OPENAI_API_KEY is missing  [BLOCKING]
✗ embedding_key        OPENAI_API_KEY is missing  [BLOCKING]
✓ database             reachable
✓ schema               migrated
✓ vector_width         EMBEDDING_DIM 1536, vector column 1536
✗ real_corpus          no non-synthetic servable source: this is a synthetic or empty database, not the production corpus  [BLOCKING]
✗ embedding_model      0 of 0 servable chunks (0%) carry a text-embedding-3-small vector; required ≥ 90%  [BLOCKING]
✗ p0_any               0 of 11 P0 laws servable  [BLOCKING]
Preflight: BLOCKED — not a live environment; nothing was run.        (exit 2)
```

So a synthetic corpus or test models can never produce a result labelled "live". The integration test asserts this for the runner, `eval.ts --mode live`, `benchmark.ts` and `eval:preflight`: each exits 2 and writes no result.

---

## Verdict

**FIXED but blocked by an explicit external dependency.**

Every defect found in this phase that did not need outside access (P21-01 … P21-28, including the one regression this phase introduced) was:
- reproduced by a failing test where a test could reproduce it (defects found by inspection were confirmed by reading and then tested);
- fixed;
- covered by a regression test;
- re-run through every suite of both applications.

**Offline results.**
- All binding gates pass offline.
- The held-out sets pass too, but their failures drove the fixes. That shows the observed failures were repaired, not that the code generalises (§5).
- On questions nobody had tuned against, recall@8 was 0.69–0.76.

What cannot be proven from here is the live system: real models over the real Jordanian corpus, with legal answers checked by a qualified lawyer. That proof is blocked by the dependencies in §17 (B-1 to B-6). Until `npm run eval:live` passes the binding gates on the real corpus, AI stays disabled for real client data.
