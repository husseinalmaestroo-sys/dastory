# Phase 2 — Corpus repair report

**Date:** 2026-10-05.

**Commits.**
- Engine `ailegal_hussein`: `901ef9f`, branch `claude/ailegal-hussein-phase2`. CI `ai-engine` run #13: green.
- Dastoori: `c4a522d` (code), plus the commit carrying this report. Branch `claude/hopeful-ritchie-gip3i7`.

**This phase is NOT complete.** What follows is everything that could be fixed from the repository without the production corpus, and the exact work still owed against it.

The production database (Neon) and model credentials were not available in this environment. Nothing below was measured on the real corpus.

**Status words used here:**
- **FIXED**: the code or data was changed.
- **TESTED**: a test exercises the change and passes.
- **UNVERIFIED**: no evidence yet that it holds on the production corpus or with real models.
- **BLOCKED BY EXTERNAL DEPENDENCY**: cannot advance without something named in [§9](#9-exact-external-dependencies).

**The design goal, now met in code:** the corpus pipeline is *safe by default*. Nothing is served until it has passed an integrity check. That stays true even if no one ever runs the repair tooling.

---

## 1. What was discovered

### 1.1 The Phase 2 reports overstated what was missing

`PHASE2_REPORT.md` said no record showed that 7 of the 10 "missing" core laws were ever ingested. That was wrong.

**Four of them appear in historical retrieval results:**
- Personal Status;
- Arbitration;
- Consumer Protection;
- Real Property (under a damaged title).

The evidence is `benchmark/comparison-snapshot-before.json` and `comparison-snapshot-after.json`. The engine's own code comments also say "the 10 laws" were ingested on 2026-07-19.

**Three are still not proven present:** Evidence 30/1952, Landlords & Tenants 11/1994, Income Tax 34/2014.

### 1.2 The Phase 2.1 authority model mixed separate facts

**One status carried two meanings.**
- `integrity_status = verified` meant "compared with *the official publication*". That publication could be the Legislation and Opinion Bureau's copy, not the Official Gazette.
- `authoritative` meant "official provenance + verified".
- The interface turned this into "مصدر رسمي متحقَّق منه" ("verified official source"), and the grounded disclaimer said "مصادر قانونية موثّقة" ("documented legal sources").

**Unchecked texts were served.** `unverified` was a *servable* state. No text had ever been checked, and every text was served.

### 1.3 The "servable" rule was written five times, inconsistently

The rule appeared separately in:
- the search arms;
- the full-row fetch;
- title resolution;
- citation verification;
- the corpus version.

Two of those copies were weaker than the rest:
- **Title resolution** did not exclude synthetic sources.
- **The full-row fetch** did not require `status = 'ready'`.

### 1.4 Known defects recorded in the engine repository

| Defect | Record |
|---|---|
| **Civil Code 43/1976 (source id 2) is character-corrupted.** Orphan-letter ratio 6.1%; substitution corruption. | `benchmark/legal-qa-100.json` `_blocked`; `src/lib/ingest/quality.ts` |
| **Old Penal Code 16/1960 (id 3) is corrupted (16.3%).** It was kept as history with `is_current_version = false`. A *historical* question could still retrieve it. | `legal-qa-100.json` `_blocked`; `benchmark/rerank-eval.json` |
| **The Penal Code in service (id 170) was re-ingested from a *secondary* Jordanian source.** Provenance was not recorded. | `legal-qa-100.json` `_blocked` |
| **Commercial, Labour and Companies (ids 159, 160, 161) were re-ingested from lob.gov.jo.** Provenance was not recorded. | `benchmark/rerank-eval.json` `_comment` |
| **Labour article 138 was entered by hand.** Its text was checked only against two secondary websites. It may duplicate article 138 of law id 160. | `scripts/tmp-add-labor-limitation.ts`; `deploy/sources/jordan-core-laws-missing.txt` |
| **The Real Property title is damaged:** "قانون الملكية العقارية لسنة أحكام عامة". A chapter heading sits where the year belongs. | comparison snapshots |
| **Memoranda of understanding were filed as `instruction`.** | `scripts/tmp-ingest-mous.ts` header |
| **Decisions of the Special Bureau for the Interpretation of Laws were filed as `principle`.** | `deploy/ingest-all.sh` step 4 |
| **A notary fee schedule was filed as a pleading template, and an executive decision as a court decision.** The Ministry of Justice lists both under its *regulations*. | `deploy/sources/moj-regulations-ar.txt`; `deploy/ingest-all.sh` step 2 (no `--type`) |
| **Bar Association decision republications have no recordable provenance.** Their file names (`camscanner1.pdf` …) do not match the listed page URL. | `deploy/sources/jba-decisions.txt` |

### 1.5 Metadata and classification bugs

- **Tatweel hid law numbers.** Titles taken from file names carry tatweel, as in "قانــــون العفو العام رقـم 5 لسنـــــة 2024". The number parser missed "رقـم", and the classifier missed "قانــون".
- **Every leading "لائحة" was classified as a pleading template.** That included fee schedules.

### 1.6 The required-law registry

- **One basis was wrong.** The Constitution cited `moj-laws-ar.txt`, but its source is `moj-constitution-ar.txt`.
- **Ten laws' numbers and years rest only on a guidance list.** `jordan-core-laws-missing.txt` itself says they are "for guidance, to be checked against the official file".
- **None is checked against the Gazette.**

### 1.7 A pre-existing bug, found by this phase's tests

`getChunksByIds` never returned a row.
- **The cause.** node-postgres returns BIGINT ids as strings, and they were compared with numeric ids.
- **The effect.** Since Phase 2, `/api/draft/refine` has run without the draft's sources. The failure was safe: citations were stripped, not invented.
- **A test was vacuous.** The Phase 2.1 test "a client-supplied id cannot reach a quarantined text" passed only because nothing could be reached.

### 1.8 Interface and landing claims no record supports

- **FAQ:** "updated daily from the Official Gazette and the Legislation Bureau; any new law added automatically within 24 hours". The repository's own notes say ingestion is manual, and that lob.gov.jo cannot be fetched automatically.
- **Features:** "+10,000 Jordanian laws updated daily" and "مصادر موثّقة" ("verified sources").
- **AI engine section:** "إجابة موثقة" ("verified answer"); "أحكام محكمة التمييز والعدل العليا" (Court of Cassation and High Court judgments), which are not in the corpus; "مستنداً إلى نصوص موثقة" ("based on verified texts").
- **Search page:** the badge "مُسند لمصدر موثّق" ("grounded on a verified source"), and a list of searchable laws that included the Civil Code.

### 1.9 A false positive the new integrity check would have caused

The Constitution is ingested as ten chapter files. Measured from article 1, a chapter whose articles start at 40 looks like it is missing 65% of its articles. **Fixed** — see [§3](#3-what-was-actually-fixed), row R-04.

---

## 2. What was corrected

| Document or data | Correction |
|---|---|
| `PHASE2_REPORT.md` §6 and summary rows | The seven-laws statement is struck through and corrected. A table of separate states has been added; for the four retrieved laws, only PRESENT / RETRIEVED (historical) is established. |
| `PHASE2_FINAL_REPORT.md` §4 | The same correction. |
| `PHASE2_FINAL_REPORT.md` §2 | A note that rows P21-16 and P21-26 are superseded: "authoritative" now means Gazette-verified. |
| `deploy/sources/required-laws.json` | The Constitution's basis is now `moj-constitution-list`. Every law now carries an `evidence` field naming the exact record its number and year are copied from. `_what` and `_verification` describe the separate states. |
| `deploy/ingest-all.sh` | Special Bureau decisions are ingested as `interpretation`. |
| `scripts/verify-pipeline.ts` | Two legacy checks encoded the misclassifications ("لائحة أجور → template", "قرار بتحديد … → court_decision"). They are replaced, citing the Ministry's regulations list. |

---

## 3. What was actually fixed

Every row is **FIXED**. For anything about the production corpus, see the last column, and the "applied on Neon" caveat in [§4](#4-what-remains-unverified).

| # | Fix | Where | Evidence | Status |
|---|---|---|---|---|
| R-01 | **Five separate facts, none inferred from another.** Provenance; `integrity_status` (unchecked / passed / quarantined / replaced); `gazette_status` with its reference, who and when; version; and authority, which is derived and never stored. A database constraint refuses `gazette_status = 'verified'` without a reference. `authorityLevel` says exactly what may be claimed. | `db/schema.sql`, `src/lib/corpus/integrity.ts` | Unit `corpus.test.ts` (authority); integration `corpus-repair.test.ts` (Gazette rules, constraint) | FIXED, TESTED |
| R-02 | **Safe by default.** New rows start `unchecked`, and only `passed` is ever served. Phase 2.1 values migrate as follows, each change logged as an event:<br>• `unverified` → `unchecked`, served again only after the check;<br>• `verified` → `passed`, with the Gazette status left unverified. | `db/schema.sql` | Migration test on a real schema: an old `verified` row becomes `passed` + Gazette unverified, with an event | FIXED, TESTED |
| R-03 | **One servability rule for every route.** Search, the full-row fetch, `getChunksByIds`, title resolution, citation verification and the corpus version all use `servableSourceSql`. Its in-memory twin, `isServableSource`, is proven identical over all 48 state combinations. | `integrity.ts`, `hybrid.ts`, `law-reference.ts`, `citation-verify.ts`, `versioning.ts` | Integration "never served": 6 states (quarantined, unchecked, replaced, not ready, non-Jordanian, fixture outside evaluation) × 4 routes, plus the corpus version; a superseded text and a text garbled at ingest, through search. Each after a positive control. | FIXED, TESTED |
| R-04 | **Integrity check, at the end of every ingest and on demand.** It runs on the full text and quarantines when:<br>• the source is empty;<br>• the whole text is garbled;<br>• more than 10% of sizeable chunks are unreadable;<br>• a statute misses more than 20% of its article numbers. A chapter file of a law is measured from its own first article. An automatic check never moves a quarantined or replaced text. | `src/lib/corpus/check.ts`, `ingest/pipeline.ts` | Unit (verdicts, chapters); integration (garbled at ingest; recheck after damage) | FIXED, TESTED. Thresholds UNVERIFIED on production ([§4](#4-what-remains-unverified)). |
| R-05 | **Civil Code (launch blocker).** The manifest quarantines source 2, but only if its title contains "المدني". The text is kept and never served. A question naming the law gets `law_unavailable`: "موجود في قاعدة البيانات، لكن نصه المحفوظ محجوب…" ("in the database, but its stored text is held back"). Never "not in the database", and nothing of it is quoted. Retrieval, title resolution, citation lookup, current-version resolution and client-supplied ids all fail to reach it. The preflight blocks while it is servable. | `deploy/sources/corpus-repairs.json`, `src/lib/corpus/repairs.ts`, `chat.ts` | Integration "the Civil Code case" on a stand-in law | FIXED, TESTED. **BLOCKED BY EXTERNAL DEPENDENCY** for production (apply on Neon; clean replacement text). |
| R-06 | **Old Penal Code (id 3) quarantined.** Also a launch blocker. Historical questions can no longer reach the corrupted text. | manifest | Same mechanism as R-05 | FIXED. UNVERIFIED until applied on Neon. |
| R-07 | **Provenance recorded, never overwritten.**<br>• Penal Code 170: secondary.<br>• LOB re-ingests 159, 160 and 161: official (Legislation Bureau). This is **not** Gazette-verified.<br>• Bar Association republications: secondary.<br>• Labour article 138: secondary, plus a review item. | manifest | Integration: a recorded provenance is kept (`conflict`) | FIXED. UNVERIFIED until applied. |
| R-08 | **Real Property title repaired** to "قانون الملكية العقارية". The citation label on every chunk follows. **No number or year is added.** The only mention, "13 لسنة 2019", is in the guidance-only list, so the metadata stays *incomplete*. | manifest | Integration: retitle with label; no number invented | FIXED. UNVERIFIED until applied. |
| R-09 | **Source classes kept separate in ranking.** The classes are legislation, regulation, instruction, interpretation, court decision, MOU and secondary. Admitted legislation ranks above interpretations, then decisions, then MOUs and secondary material, *whatever their lexical score*. The gap cutoff runs within each class. The exceptions are explicit in the question: asking for decisions (a decision number, "اجتهاد", "قرار محكمة"…) or about the memorandum itself. Citations carry `sourceClass`. | `src/lib/corpus/source-class.ts`, `hybrid.ts` | Unit (ordering, exceptions; "ما حكم القانون" is not a request for judgments); integration in live search, where an MOU that **scored higher** still ranks below the law | FIXED, TESTED |
| R-10 | **Classification.** "مذكرة تفاهم" → `mou`. "قرار الديوان الخاص بتفسير" → `interpretation`. A pleading ("لائحة دعوى") → template; any other "لائحة" → regulation. "قرار بتحديد / بتعيين…" → instruction. Existing rows are reclassified by the manifest. Before that, ranking reads the class from the title. | `ingest/classify.ts`, manifest | Unit; verify 382/382 | FIXED, TESTED. Existing rows UNVERIFIED until applied. |
| R-11 | **Titles, law numbers and years normalised.** Tatweel, diacritics, digit forms, underscores, "رقم (46)" and a reversed lam-alef are handled. A number or year is taken **only** from the title's own "رقم N" / "لسنة YYYY", only when none is recorded, never beyond 1900…next year, never overwriting. Every change is an event. The Arabic-Indic digit loss was caught by a test before commit. | `ingest/title.ts`, `law-identity.ts`, `corpus/maintenance.ts` | Unit; integration `normalize-titles` | FIXED, TESTED |
| R-12 | **The registry checked against the repository's own records.** Every number and year must be found together in the list the entry cites, and every benchmark law must be registered. One error was fixed (the Constitution's basis), and evidence was recorded for all 19 laws. | `src/lib/corpus/registry-check.ts` | Unit test against the real repository files: 0 errors, and the 10 guidance-only laws listed | FIXED, TESTED |
| R-13 | **The inventory reports every state on its own.** The states are present, servable, official source, Gazette-verified, current, embedded, searchable, authoritative and number/year known; each is true only for a servable text. It also flags never-checked texts, malformed titles, incomplete metadata, misfiled classes, unlinked amendments and the same text held in two files. | `src/lib/corpus/inventory.ts`, `scripts/corpus-inventory.ts` | Unit | FIXED, TESTED |
| R-14 | **The live preflight now also blocks on:**<br>• any never-checked non-synthetic source;<br>• any applicable manifest repair not yet applied;<br>• any launch-blocking defect still servable (or unconfirmable, e.g. id 2 holding another law).<br>It still never labels synthetic results as live. | `src/lib/eval/live-preflight.ts` | Unit; integration; the commands themselves ([§10](#10-exact-commands-to-finish-live-verification)) | FIXED, TESTED |
| R-15 | **Interface wording.** One wording source is used: "من جهة نشر رسمية — لم يُقارن بالجريدة الرسمية" (from an official publisher, not compared with the Gazette), and the like. "قورن نصه بالمنشور في الجريدة الرسمية" (compared with the Gazette) appears only when it was. No label says "موثّق" or "متحقَّق منه" ("verified"). Every mode has an Arabic label. Each source card shows its class and authority. The landing and search claims in [§1.8](#18-interface-and-landing-claims-no-record-supports) are removed. | Dastoori `src/lib/ai/source-labels.ts`, assistant and search pages, landing | Unit (labels); staging browser test | FIXED, TESTED |
| R-16 | **Dastoori accepts `law_unavailable`.** Before this, it would have been a 502. Dastoori also reads `gazetteStatus`, `authorityLevel` and `sourceClass`, and rejects contradictions. An older engine's "verified" is never shown as a Gazette verification. | Dastoori `engine-schema.ts` | Unit; **staging, real engine + production bundle**: the quarantined fixture law is answered `law_unavailable` through both the assistant and the search | FIXED, TESTED |
| R-17 | **`getChunksByIds` fixed** ([§1.7](#17-a-pre-existing-bug-found-by-this-phases-tests)). | `hybrid.ts` | The "never served" test now has a positive control | FIXED, TESTED |
| R-18 | **Grounded-answer disclaimers say exactly what is recorded.**<br>• The "verified" disclaimer is used only when every cited text is Gazette-verified, and it says "قورنت بنصها المنشور في الجريدة الرسمية" (compared with the text published in the Gazette).<br>• Otherwise: "لم تُقارَن بعد بنصها المنشور في الجريدة الرسمية" (not yet compared with the Gazette). | `src/lib/ai/prompts.ts`, `chat.ts` | Integration: an official, not-compared text keeps the not-compared disclaimer | FIXED, TESTED |

### Regression on this phase's final code

**Engine:**
- Typecheck clean.
- Unit 113/113.
- Integration 71/71.
- Pipeline verify 382/382.
- Build OK.
- HTTP 13/13.
- **Offline evaluation:** every pre-registered gate passes. All 38 metrics are identical to the committed 2026-09-28 run (`eval/results/offline-2026-10-05.json`), so the repair neither improved nor degraded the synthetic measurements.
- CI `ai-engine` run #13: green.

**Dastoori:**
- Typecheck and lint clean.
- Unit 214/214.
- Integration 373/373.
- HTTP 112/112.
- Browser E2E 3/3.
- Staging (real engine + production bundle) 15/15.
- Build OK.

**Gates and dataset untouched.** `eval/gates.json` and the pre-registered `eval/dataset.json` were not edited.

**Payment untouched.** No Stripe, billing, checkout or subscription code was touched.

---

## 4. What remains unverified

- **Everything about the production corpus.**
  - Which rows exist.
  - Whether ids 2, 3, 159, 160, 161 and 170 still hold the texts the repository records. The manifest checks each id *and* title, and reports a mismatch instead of acting.
  - What the integrity check will decide for each text.
- **The integrity thresholds on real texts.** **UNVERIFIED.**
  - The whole-text garbling test reuses the Phase 2.1 measurement on the 24 Ministry of Justice laws.
  - The per-chunk test (≥ 600 Arabic letters; ≤ 1 common word, or > 12% orphan letters) and the 20% article-gap rule are new, and were not calibrated on production.
  - Errors will fall on the safe side: some sound texts may be quarantined, for example table-like schedules with few common words. **The quarantine list must be reviewed after the first `prepare --apply`**, and a false positive passed by hand with a reason.
- **Nothing is served between migration and preparation.** After `db:migrate`, every production text is `unchecked`, and nothing is served until `prepare --apply` has run. This is safe by design, but the two must run together, before traffic is switched ([§10](#10-exact-commands-to-finish-live-verification)).
- **Gazette verification: zero sources.** None can become Gazette-verified without a reviewer and a Gazette reference. Until then every grounded answer says its texts were not compared with the Gazette.
- **Real models.** No live run happened. Retrieval with real embeddings, the class ordering's effect on real answers, and grounding with a real judge are all UNVERIFIED.
- **One edge case.** If a law's base text is held back but an *amending act* of it is servable, a question naming the law resolves to the amending act. The answer would say nothing about the held-back base. No amendment of the Civil Code appears in the repository's lists, so this does not arise for the known defects. UNVERIFIED for production.
- **Registry numbers and years.**
  - 8 laws: copied from Ministry of Justice file names.
  - 10 laws: copied from a guidance-only list.
  - The Constitution: no number.
  - None checked against the Gazette.

---

## 5. Which laws are confirmed only by repository evidence

No law below is DATABASE VERIFIED. "Retrieved" means it appears in a saved historical retrieval result. That is not proof it is in today's database, nor in what state.

| Law | Repository evidence | Established states |
|---|---|---|
| Civil Code 43/1976 | `legal-qa-100.json` `_blocked` (id 2, corrupted); retrieved as "قانون المدني" in comparison snapshots; Ministry list | PRESENT / RETRIEVED (historical). **Corrupted.** |
| Penal Code 16/1960 | `_blocked` (id 170 secondary, 476 articles, orphan 2.0%; id 3 corrupted history); "قانون العقوبات الأردني مع كامل التعديلات" and an amending act retrieved | PRESENT / RETRIEVED. Secondary provenance (recorded fact, not yet in the database). |
| Commercial 12/1966 | `rerank-eval.json` (id 159, lob.gov.jo); retrieved | PRESENT / RETRIEVED; official source per the repository record |
| Labour 8/1996 | `rerank-eval.json` (id 160, lob.gov.jo); article 138 entered by hand; retrieved | PRESENT / RETRIEVED; official source per the record (id 160) |
| Companies 22/1997 | `rerank-eval.json` (id 161, lob.gov.jo); retrieved | PRESENT / RETRIEVED; official source per the record |
| Civil Procedure 24/1988 | Ministry list; retrieved | PRESENT / RETRIEVED |
| Criminal Procedure 9/1961 | Ministry list; retrieved | PRESENT / RETRIEVED |
| Personal Status 15/2019 | retrieved as "قانون الأحوال الشخصية الأردني"; number and year from the guidance list only | PRESENT / RETRIEVED |
| Arbitration 31/2001 | retrieved; number and year from the guidance list only | PRESENT / RETRIEVED |
| Consumer Protection 7/2017 | retrieved; number and year from the guidance list only | PRESENT / RETRIEVED |
| Real Property (number/year not established) | retrieved under the damaged title | PRESENT / RETRIEVED; metadata incomplete |
| Constitution; Execution 25/2007; Courts Formation 17/2001; Notary 11/1952; Mediation 12/2006 | on the download lists that `deploy/ingest-all.sh` ingests; never seen in a retrieval result | LISTED FOR INGESTION only |
| Evidence 30/1952; Landlords & Tenants 11/1994; Income Tax 34/2014 | guidance list; code comments say "the 10 laws" were ingested on 2026-07-19 | **NOT PROVEN PRESENT** |

---

## 6. Which laws require Neon confirmation

**All 19 registry laws.** Each state in [§3](#3-what-was-actually-fixed) row R-13 must be read from the real database by `npm run corpus:inventory`. In particular:

- **The 3 not-proven laws:** Evidence, Landlords & Tenants, Income Tax. Are they present, and if so, in what state?
- **The 5 "listed for ingestion" laws:** the Constitution, Execution, Courts Formation, Notary, Mediation. For the Constitution, also check that its chapter files pass the integrity check.
- **The rows the manifest names:** ids 2, 3, 159, 160, 161, 170; the hand-entered Labour article 138; the damaged Real Property title; the MOUs, interpretation decisions, fee schedule, executive decision and Bar Association republications. `prepare` (dry run) prints, for each entry, whether it applies, is already done, is absent, mismatches, or conflicts.
- **Every text the first integrity check quarantines.** These are not knowable in advance.

---

## 7. Which laws require authoritative-source replacement

| Law | Why | What replaces it |
|---|---|---|
| **Civil Code 43/1976. LAUNCH BLOCKER.** | The stored text is corrupted. It is quarantined, so civil-law questions are answered "unavailable". | A clean text from the Legislation Bureau's digital text, or a Gazette scan transcribed and reviewed. Ingest it as a new source, then `corpus:integrity replace 2 <newId>`. **No replacement text is fabricated or reconstructed here.** |
| Penal Code 16/1960 | The text in service (id 170) is a secondary republication. The old official-looking text (id 3) is corrupted. | For authority: compare id 170 with the Gazette (`gazette-verify`, which leaves it secondary), or replace it with an official text. |
| Labour Law, article 138 | Entered by hand, checked only against secondary websites. It may duplicate id 160. | Compare with id 160's article 138. Then link or replace it (manifest review item `labour-article-138-review`). |
| Real Property | The title was damaged at extraction, and the number and year are not established. | The official text gives the number, year and version in force. |
| Any text the first `prepare --apply` quarantines on Neon | Unknown until run. | Per text, after review. |

---

## 8. Which laws require lawyer verification

- **Every registry entry's number, year and version in force.** The registry is labelled UNVERIFIED METADATA. The ten guidance-only entries need this first: Evidence, Commercial, Labour, Companies, Personal Status, Landlords & Tenants, Real Property, Arbitration, Income Tax, Consumer Protection.
- **Personal Status.** The guidance list itself says to check its number and year at ingest: it has been amended.
- **Real Property.** The list says it "unified previous real-estate legislation". Which law is in force must be established.
- **Every Gazette verification.** `gazette-verify` needs a reviewer and the Gazette reference.
- **The quarantine list after the first `prepare --apply`.** False positives are passed with `corpus:integrity pass <id> --actor --reason`.
- **Labour article 138.** Duplicate or not.
- **The executive decision "قرار بتحديد الصحف الأوسع انتشاراً".** It is filed as `instruction`, the nearest type the schema has. A lawyer may prefer another class.
- **The benchmark gold answers** (`benchmark/legal-qa-100.json`). These were never verified by a lawyer, as noted in earlier reports.

---

## 9. Exact external dependencies

- **A Neon connection string** (`DATABASE_URL`) for the production corpus, with write access: `db:migrate` and `prepare --apply` write.
  - Run everything first on a **Neon branch** (a copy) and review the result before production.
- **Model credentials.**
  - `OPENAI_API_KEY` for embeddings, and for chat with `CHAT_PROVIDER=openai`.
  - `ANTHROPIC_API_KEY` if `CHAT_PROVIDER=anthropic`.
  - Optionally a reranker key: `COHERE_API_KEY` or `VOYAGE_API_KEY`.
  - These are set as secrets or environment variables in the environment's settings. **They are never pasted into a chat.**
- **Network access** from the machine that runs the commands to the Neon host and to the model providers' API hosts.
- **A clean authoritative Civil Code text**, and Gazette access for verification and replacements.
- **A qualified Jordanian lawyer or reviewer** for [§8](#8-which-laws-require-lawyer-verification).

---

## 10. Exact commands to finish live verification

Run these in `ailegal_hussein`, with `DATABASE_URL` pointing at a **Neon branch first**, then at production. Deploy Dastoori `c4a522d` (or later) **before or together with** engine `901ef9f`. An older Dastoori rejects `law_unavailable`; it shows an error, and nothing wrong is served.

```sh
npm ci
npm run db:migrate                                    # separate states; Phase 2.1 values migrated, each change an event
npm run corpus:inventory -- --md inventory-before.md --json inventory-before.json
npm run corpus:integrity -- prepare                   # DRY RUN: manifest, provenance, titles, integrity check — prints every decision
npm run corpus:integrity -- prepare --apply           # apply (run right after db:migrate: until then nothing is served)
npm run corpus:integrity -- history 2                 # the Civil Code's audit trail: quarantined by repair-manifest:civil-code-43-1976-corrupted
npm run corpus:inventory -- --md inventory-after.md --json inventory-after.json
npm run corpus:inventory -- --strict                  # exits 1 while critical anomalies remain (missing P0 laws included)
npm run eval:preflight                                # static checks; exit 2 = BLOCKED, nothing run
npm run eval:preflight -- --probe                     # + one short embedding and one tiny chat call (only if the static checks pass)
npm run eval:live                                     # runs only when the preflight passes; results labelled live
```

**What the commands do here.** They were run against this environment's synthetic test database:
- `corpus:inventory` reports.
- `prepare` reports each manifest entry as "not in this database".
- `eval:preflight -- --probe` and `eval:live` exit **2 BLOCKED**, as they must: "no non-synthetic servable source", missing keys. No probe ran and nothing was measured.

**After the run: the reviewer's commands.**

```sh
npm run corpus:integrity -- pass <id> --actor "<name>" --reason "<why the check was wrong>"
npm run corpus:integrity -- gazette-verify <id> --actor "<name>" --reason "<what was compared>" --evidence "<Gazette issue/page, URL or sha256>"
npm run ingest -- <folder with the clean Civil Code> --type=law --law-number=43 --year=1976 --effective-date=<YYYY-MM-DD>
npm run corpus:integrity -- replace 2 <newId> --actor "<name>" --reason "clean official text" --evidence "<reference>"
```

**Done means all of the following:**
- the preflight passes on production;
- `eval:live` meets the pre-registered gates;
- the Civil Code is replaced, or launch is consciously held for it;
- a lawyer has signed off on [§8](#8-which-laws-require-lawyer-verification).

**None of this has happened yet.**
