# Phase 2.4: Live corpus verification report

**Date:** 2026-10-05 to 2026-10-06.

**Commits.**
- Engine `ailegal_hussein`: `c9793d0` (the pre-registered probes, committed alone and before any live run), then `5efbca1` (this phase's tooling), then `47d2036` (README and script comments only: when the guard refuses), then `a1e22b0` and `f83fe4f` (the evidence of the branch run, §3a and §3b). Branch `claude/ailegal-hussein-phase2`, parent `901ef9f`.
- Dastoori: `d7634c8` (this report), then the commit carrying the branch-run update; branch `claude/hopeful-ritchie-gip3i7` (parent `01b22a7`). No Dastoori code changed in this phase.

## Verdict

**LIVE-CORPUS-VERIFIED on a branch copy of production (2026-10-06). Not REAL-MODEL-VALIDATED: three answer-quality gates fail on real measurements. Production is unchanged.**

- Phase A (pre-flight) ran.
- Phases B and C ran on `phase24-verify`, a branch made from production on 2026-10-06 ([§3a](#3a-branch-run-on-a-copy-of-production-2026-10-06)):
  - identity, snapshot and inventory before any change;
  - the migration of the branch;
  - a dry run of the preparation, reviewed and approved;
  - the preparation, applied.
- Phases D to G ran on the same branch with real models ([§3b](#3b-live-measurements-with-real-models-2026-10-06)):
  - **The corpus holds.** The preflight passes; every critical-law check passes; the pre-registered probes pass 30 of 32, with no hard-check violation; every security gate passes.
  - **The answers do not yet meet their gates.** 3 of 101 article mentions fail the fabricated-citation test (a hard gate); citation support is 89.5% (gate 95%); 8 of 18 answerable questions get a grounded answer (gate 80%).
  - Two retrieval gates of the live suite cannot be measured in live mode and are scored as failures: a defect in the gate setup.
- Production has not been migrated or prepared.
- Everything was first built, tested, and rehearsed end to end on a production-shaped stand-in database ([§3](#3-rehearsal-on-a-production-shaped-stand-in)), and the live work is one reviewed command sequence ([§8](#8-exact-commands)).

**The numbers in §3a, §3b and §5 are read from the branch copy of production. The probe scores of §3 (stand-in) still say nothing about the corpus.**

**Status words.**
- **FIXED**: the code or data was changed.
- **TESTED**: a test exercises the change and passes.
- **REHEARSED**: run end to end on the stand-in database of §3. Its texts are invented placeholders. It proves the procedure works and measures nothing about the corpus.
- **BRANCH-VERIFIED**: read from, or changed on, the branch copy of production, with the output committed as evidence (`evidence/live-20261006/` in the engine).
- **UNVERIFIED**: no evidence yet on the production corpus or with real models.
- **BLOCKED BY EXTERNAL DEPENDENCY**: cannot advance without something named in [§7](#7-exact-external-dependencies).

---

## 1. Phase A: pre-flight (executed)

| Check | Result |
|---|---|
| Engine repository | Branch `claude/ailegal-hussein-phase2`. Parent `901ef9f` had a green CI run. This phase is commits `c9793d0`, `5efbca1`, `47d2036`, and the evidence `a1e22b0` and `f83fe4f`. |
| Dastoori repository | Branch `claude/hopeful-ritchie-gip3i7`, from `01b22a7`: this report and its updates only. |
| `DATABASE_URL` | **Absent** at first. No `.env` file (the engine has only `.env.example`). On 2026-10-06: a connection string for the branch `phase24-verify`, kept outside the repository and never printed by any command. |
| `DATABASE_ENVIRONMENT`, `PRODUCTION_DATABASE_HOST`, `DATABASE_TRANSPORT` | Absent at first. Set on 2026-10-06 in the environment's settings: `branch`, the production endpoint host, `neon-websocket`. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `VOYAGE_API_KEY` | **Absent.** Checked by name only; no value was read or printed. `OPENAI_API_KEY` is still not set. |
| Network to Neon | The environment's egress proxy refuses `console.neon.tech:443` and a Neon endpoint host (`*.aws.neon.tech:443`) with HTTP 403: no allowlist rule. Direct TCP to port 5432 times out (filtered). The policy was not routed around. Since 2026-10-06 the policy is Custom: the branch's two hostnames (direct and pooled) are allowed; the production hosts are still refused (proxy 403, checked for both). |
| Network to OpenAI | The proxy refuses `api.openai.com:443`. The engine's own provider probe, sent through the proxy, reports `403 request blocked: no rule or allowlist entry allows host "api.openai.com"`. Allowed since 2026-10-06: `api.openai.com` answers 401 to a request without a key. |
| Network to Anthropic | `api.anthropic.com` is on the proxy's bypass list, but no key is set. No call was attempted. |
| Neon from the desktop | No Neon connector is attached to this session, and it cannot operate your browser. On 2026-10-06 you created the branch and changed the environment's settings with Claude in Chrome, a separate session. |
| Database identity, migration version | **On the branch:** PostgreSQL 18.6, no recorded schema version, 8 items the pipeline needs missing (the schema predates Phase 2.1). After the migration: fingerprint `01541b3d842852ae…` (sha256 of `db/schema.sql`), matching the checkout, nothing missing. |
| Engine ↔ Dastoori compatibility | Unchanged: no API shape changed in this phase. Pairing still requires Dastoori `c4a522d` or later with engine `901ef9f` or later (the `law_unavailable` mode). |
| `npm ci` | The lockfile carries the new dependencies. CI's `npm ci` passed on `5efbca1`. |
| `npm run db:migrate` on Neon | **Run on the branch only**, 2026-10-06, after `db:identity` confirmed the target was the branch. Not run on production. |

---

## 2. What was built in this phase

Every row is **FIXED** and **TESTED** unless it says otherwise.

| # | What | Why | Evidence |
|---|---|---|---|
| A-1 | **Target identity and write guard** (`src/lib/db-target.ts`). The commands that change the schema or the corpus print their target: host, database, Neon endpoint, environment, and the basis for that environment. When they write, they refuse an undeclared remote database, and production without `--confirm-production`. This covers `db:migrate`, `ingest`, `corpus:integrity` (`--apply` and single-source writes), `reindex`, both backfills and `link-amendments --apply`. A dry run only reads and is not refused. `db:seed` and the synthetic evaluation fixtures load only into a local or staging database. **Not guarded:** the retention purge (`scripts/purge-content.ts`), which deletes expired logs and is meant to run daily on production from cron. Measurements switch automatic retention off instead (G-3). A host listed in `PRODUCTION_DATABASE_HOST` is production even when declared a branch, and its `-pooler` host counts as the same endpoint. | Constraint 8: work on a branch first, never on production by accident. | `tests/unit/db-target.test.ts`, which also checks that no credential is printed. Pointed at an undeclared remote host, `reindex`, both backfills, `link-amendments --apply` and `db:seed` each refuse before connecting, and none prints the password. |
| A-2 | **Schema version and identity.** `db:migrate` records the sha256 of the `db/schema.sql` it applied (table `schema_versions`). `npm run db:identity` reads it, along with: the server and Neon timeline/tenant, the columns this pipeline needs that are missing, and corpus counts. Read-only; works on any schema. | Phase A: identity and migration version, with no credentials. | REHEARSED: before migration (fingerprint none, 8 required items missing) and after (fingerprint matches the checkout, none missing). |
| A-3 | **`deploy/deploy.sh`** requires `CONFIRM_PRODUCTION=yes`. It runs `corpus:integrity prepare --apply` right after the migration. **`deploy/ingest-all.sh`** passes the same confirmation to its migration and its five ingests. It migrates before anything else, `--dry-run` included, so a dry run on production needs the confirmation too. | After migration every older text is `unchecked`, and nothing is served until preparation runs. | `deploy.sh`: same order as the rehearsal. `ingest-all.sh`, run against a stub `npm` that only records its arguments: the flag reaches the migration and all five ingests with `CONFIRM_PRODUCTION=yes`, and never otherwise. |
| A-4 | **The engine image could not run its own migration.** `deploy.sh` runs `scripts/migrate.ts` in the image, but the image never contained `src/`, so `../src/lib/pg-ssl` failed. This has been true since the initial commit. The corpus preparation also needs `deploy/sources/`, which `.dockerignore` excluded. Both are now in the image; the rest of `deploy/` is still excluded. | A production deploy would have stopped at the migration. | Reproduced with the runtime file set ("Cannot find module '../src/lib/…'"). Fixed: migration and preparation run with that file set. Build context checked with Docker: `src/` and `deploy/sources/` are in it; `node_modules`, `.env` and the rest of `deploy/` are not. An image built from that context with the runner stage's files that these two steps use (`package.json`, `tsconfig.json`, `db/`, `scripts/`, `src/`, `deploy/sources/`), with `node_modules` mounted from the checkout rather than installed, run as `node` with `NODE_ENV=production`: the migration and the preparation both run. **Not run here:** the full image build. Its `apt-get` step gets HTTP 403 from `deb.debian.org` under this environment's egress policy, and that step comes before the lines changed. |
| B-1 | **Comparable snapshots** (`npm run corpus:snapshot`). Each snapshot records every source row as stored, plus per source the chunk count and the sha256 of its text and of its article numbering. `--compare` lists every changed field, every text change and every removed source. It exits 3 if any text changed or any source disappeared. | Constraints 9 to 11: before/after evidence. A repair never edits text or deletes a source. | REHEARSED: 8 rows changed, 0 removed, 0 text changes. |
| B-2 | **Inventory on any schema version.** The "before" inventory runs before the migration, on the database as it is. A column the schema lacks reads as its truthful default: not checked, not Gazette-verified. | Constraint 9: inventory before migration. | REHEARSED on the original schema (`0dc62ff`). |
| C-1 | **Short-text review hint.** A short text flagged as garbled, but with almost no orphan letters, now gets a non-blocking `short_text_review` note for the reviewer. The detector itself was not loosened. | The rehearsal's short decision texts were quarantined, and a real short decision with a narrow vocabulary could be too. Constraint: change the detector only on evidence; otherwise a reviewer passes the text with a recorded reason. | Unit tests; REHEARSED. |
| D-1 | **`npm run corpus:critical`** answers Phase D and E from the database, with evidence (see the next table). Exits 1 if any corrupted text is reachable. | Phase D/E without guessing. | REHEARSED: every safety check PASS ([§3](#3-rehearsal-on-a-production-shaped-stand-in)). |
| F-1 | **Pre-registered probes**, `benchmark/live-probes-2.4.json`: 32 questions across 16 categories. These cover the 14 query types asked for, plus class ordering and the not-proven laws. Gold is structural only; no legal content is encoded. **Committed before any live run.** One correction (p05, p22) was made before the file was committed and is recorded in its `_changes` field. | Phase F: measure without editing the dataset to raise scores. | `tests/unit/probes.test.ts`. |
| F-2 | **`npm run eval:probes`** runs the probes through the pipeline as served. It has two modes: retrieval (read-only, no chat model) and `--answers` (the whole pipeline, with citations checked). | Phases F/G. | REHEARSED in both modes. |
| F-3 | **The pipeline's pre-generation decisions are exported** (`earlyStop`, `relevantEvidence`, `missingArticleButAsksMore` in `pipelines/chat.ts`). The pipeline itself uses them, so the probes measure the same code. Behaviour is unchanged. | No second copy of the logic to drift. | All suites green ([§4](#4-regression)). |
| G-1 | **Provider calls go through the environment's proxy.** OpenAI, Anthropic, the reranker, Voyage and the source fetcher use `HTTPS_PROXY` when it is set, honouring `NO_PROXY`. Before, they ignored it, and the resulting connection error hid the cause. A proxy refusal (403) is reported as such and is never routed around. | Phase G in proxied environments, including this one. | `tests/unit/proxy.test.ts`, against a local CONNECT stand-in. |
| G-2 | **Neon over WebSocket (port 443).** `DATABASE_TRANSPORT=neon-websocket` uses Neon's own serverless driver, which carries the same Postgres protocol and goes through the proxy when one is set. It is for networks that filter port 5432, as this one does. | Lets the live run work from such a network. | The full integration suite over this transport, through a local WebSocket bridge: 71/71. |
| G-3 | **Measurements never purge.** The probes, the live evaluation and the live sequence set `AUTO_RETENTION=false`. | A measurement must not delete logs on the database it measures. | REHEARSED: no purge ran. |
| G-4 | **Bug fixed:** `runRetentionIfDue` answered a concurrent caller "not due" instead of joining the purge already running. Found by running the integration suite over the WebSocket transport. | An existing race in the retention purge. | Retention test passes on both transports. |
| — | **`deploy/live-corpus-sequence.sh before\|apply\|live`**: the whole live procedure. Every output is kept in `$OUT`. `apply` refuses to run without a dry run on file. `live` runs nothing unless the preflight passes. | Constraints 9 to 12. | REHEARSED ([§3](#3-rehearsal-on-a-production-shaped-stand-in)). |

**What `corpus:critical` (D-1) checks, per law.**

| Law | Checks |
|---|---|
| Civil Code | <ul><li>Is id 2 the Civil Code?</li><li>Is any corrupted text of it servable?</li><li>Is there a servable replacement candidate, and are there amending acts?</li><li>Does a named question get "unavailable"?</li><li>Does a search using its own stored words reach it?</li><li>Do client-supplied chunk ids return it?</li><li>Does a citation of it verify?</li></ul> |
| Penal Code | Do historical questions reach a held-back text (ids 3 and 170)? |
| Ids 159, 160, 161 | Provenance, integrity and Gazette state of each. |
| Labour article 138 | Compared text against text: IDENTICAL, CONTAINS or DIFFERENT, with the word overlap. |
| Real Property | Its metadata. |
| Evidence, Landlords & Tenants, Income Tax | Searched by registry match and by a loose name match, in any status. |
| All sources | Class audit: misfiled types, fee schedules, executive decisions, Bar Association republications. |

**What `eval:probes` (F-2) records and checks.**

- **The label.** A run is labelled LIVE only when the live preflight passes against the database, including one real embedding call and, for `--answers`, one real chat call. Otherwise the runner refuses (exit 2). With `--rehearsal` it runs but is labelled "REHEARSAL — NOT LIVE", and that mode never runs on production.
- **Identity.** Each run records the commit, the probe file's sha256, the target, the transport, the corpus and prompt versions, and the embedding, chat and reranker provider and model.
- **Metrics.**
  - Law level: Recall@8, MRR, Precision@8.
  - Named article: Hit@1 and MRR.
  - Designed behaviour: is the mode correct?
  - Article integrity: is the whole article returned, or an excerpt that keeps all its provisos?
  - With `--answers`: are the citation references valid, are articles asserted that appear in no retrieved source, and is the named article cited?
- **Hard checks.** One violation fails the run:
  - A chunk from a held-back source is retrieved.
  - A held-back source is cited.
  - A lower class outranks legislation and the question did not ask for that class.

---

## 3. Rehearsal on a production-shaped stand-in

**REHEARSED. Not a measurement.**

**The stand-in.** `scripts/rehearsal-build.ts` builds a local database on the **original production schema** (`db/schema.sql` at `0dc62ff`). It holds 17 sources at the ids the repository records:

- id 2: Civil Code, garbled.
- id 3: old Penal Code, garbled, not current.
- ids 159, 160, 161: Legislation Bureau texts.
- id 170: secondary Penal Code.
- Labour article 138, entered by hand.
- Real Property, with the damaged title.
- Two MOUs filed as instructions.
- An interpretation decision filed as a principle.
- A fee schedule filed as a template.
- An executive decision filed as a court decision.
- A Bar Association republication.
- A Constitution chapter.
- A title with tatweel.
- A Civil Procedure text.

**Every text is an invented placeholder; no legal text was written.** Embeddings come from the deterministic test provider.

| Step | Result |
|---|---|
| `db:identity` before | Original schema. No recorded fingerprint. 8 required columns/tables missing. 17 sources, 80 chunks. |
| `corpus:snapshot`, `corpus:inventory` before | Taken on the original schema, before migration. |
| `db:migrate` | Migrated from the original schema. Fingerprint recorded and matches the checkout. All 17 sources `unchecked`. |
| `prepare` (dry run) | **14 to apply, 1 for review** (Labour article 138), **0 mismatches, 0 conflicts**. Ids 2 and 3 quarantined by the manifest and by the check. Every other text passes. |
| `prepare --apply` | The same decisions, each recorded as an event. `history 2` shows the quarantine, with its evidence. |
| `inventory --strict` | Critical anomalies remain: the P0 laws missing from the stand-in, and two "current" Labour texts (160 and 200). This is reported as the inventory should report it. |
| `snapshot --compare` | 8 rows changed (retitles and reclassifications), **0 removed, 0 text changes**. |
| `corpus:critical` | **Every safety check PASS.** A Civil Code question gets "unavailable (quarantined)". The Civil Code's own stored words, its chunk ids and its citation reach nothing. Historical Penal questions reach no held-back text. Classes, fee schedule, executive decision and Bar Association provenance all PASS. |
| `eval:probes --rehearsal` | Labelled **REHEARSAL — NOT LIVE**: the preflight blocks on the test providers. Hard checks: **0 held-back retrievals, 0 class-order violations, 0 non-servable citations**. With `--answers`: 14/14 citation references valid, 0 generated answers asserting an article in no retrieved source. |
| The same `migrate` and `prepare` with only the files the runtime image contains | Before A-4: "Cannot find module '../src/lib/…'". After: both run. A second `prepare` is a no-op (14 already done). |

The probe scores on the stand-in (17/32) measure placeholder texts under hash embeddings. **They say nothing about the corpus** and are not reported as a result.

---

## 3a. Branch run on a copy of production (2026-10-06)

**BRANCH-VERIFIED.** Evidence: `evidence/live-20261006/` in the engine (`a1e22b0`). It contains no credential (checked before the commit).

**Setup.**
- Branch `phase24-verify` of the Neon project `ai-legal`, made from production with all its data. Endpoint `ep-noisy-base-asxes3nn`.
- The production endpoint, `ep-empty-butterfly-asmauhcv`, is in `PRODUCTION_DATABASE_HOST`. The guard refuses it, direct and pooled (checked with the real host), and the network policy refuses it too (proxy 403).
- Transport: `neon-websocket`, through the environment's proxy.

**before.**

| Step | Result |
|---|---|
| Identity | The branch, labelled BRANCH. PostgreSQL 18.6. No recorded schema version; 8 items the pipeline needs are missing (the schema predates Phase 2.1). |
| Snapshot | 230 sources, 7,531 chunks, all embedded. |
| Inventory | All 19 registry laws present. 77 critical anomalies: 40 garbled texts, 26 article gaps, and 11 P0 laws with no servable text (every text was still unchecked). |
| Migration | The branch only. Schema fingerprint `01541b3d…`, matching the checkout. All 230 sources `unchecked`. |
| Dry run | Manifest: 21 to apply, 2 already done, 4 not in this database, 0 mismatches, 0 conflicts, 0 for review. Download lists: 0 sources matched. Titles: 6. Integrity: 174 pass, 56 quarantined. |

**Review.** You reviewed the dry run and approved applying it as is, on 2026-10-06. That includes serving the Civil Code copy 172 under an unverified label.

**apply.**

| Step | Result |
|---|---|
| Manifest | 21 applied, 2 already done, 4 not in this database, 0 conflicts. |
| Titles, numbers, years | 8 sources: the dry run's 6, plus a year read from the titles of 57 and 60 once the manifest had reclassified them. The 6 are tatweel, Arabic-Indic digits, a broken "الإ" ligature, and two law numbers read from the titles. A dry run computes each step on the unchanged database, so it could not see the extra 2. Nothing was invented. |
| Integrity | 174 passed, 56 quarantined (54 by the check, 2 by the manifest before it). |
| History | Ids 2 and 3: the quarantine and its reason are recorded as events. |
| Snapshot comparison | 13 rows changed. **0 texts changed, 0 sources removed or added.** |
| Inventory after | All 19 registry laws servable, none Gazette-verified. 66 critical anomalies remain, **all on 53 held-back texts, none on a served text**. |

**Findings that differ from the earlier reports.**
1. **All 19 registry laws are present** and servable after preparation. Evidence, Landlords & Tenants and Income Tax were "not proven present".
2. **The Civil Code has a second copy, id 172, that passes the check.** It is served, and the corrupted id 2 is held back. 172's provenance is not recorded. Its article numbering is complete except 436, 454, 773, 881 and 1080. A lawyer should compare it with an official text.
3. **Most laws and regulations are stored twice:** an older copy (ids 2–70), many garbled, and a newer one (ids 172–228), nearly all clean. The garbled copies are held back. Where both copies pass, both are served, so results contain duplicates.
4. **Texts with no servable copy after preparation:**
   - amending laws: Penal Code 10/2022 (6, 183), Civil Procedure 6/2024 (4, 181), Notary 3/2026 (194);
   - regulations: the Ministry of Justice's administrative organisation 2/2022 (65, 212), the fund for victims of human trafficking 6/2023 (70, 224), alternatives to custodial sentences 46 (36, 228);
   - Constitution chapters 3 and 10 (30, 32);
   - 8 interpretation decisions (74, 79, 100, 102, 107, 124, 126, 135) and 2 Bar Association decisions (151, 158).
5. **Some of those look like false positives.** 183 and 194 are held back on article gaps alone, and an amending law cites the article numbers of the law it amends. Chapter 3 of the Constitution is very short. A reviewer can release each one after reading it (`corpus:integrity pass`, with a recorded reason). Until then they are not served.
6. **Provenance is recorded for 12 sources only:** 159–161 official; 170 and the 8 Bar Association decisions secondary. No source matched a download list, so the other 218 have no recorded provenance.
7. **Four manifest entries do not apply to this database.** It has no separate entry for Labour article 138. The Real Property title (165) is already clean, with its number and year. The interpretation-decision reclassification found no match.
8. **Two served court decisions have file names for titles:** 152 ("camscanner1") and 154 ("h2023.4564 (1)"). They need a human title.
9. **The session's automatic safety check blocked one read-only command during the review,** a dry-run listing of the title changes. It was not worked around; the changes are in the snapshot comparison.

---

## 3b. Live measurements with real models (2026-10-06)

**LIVE**: the preflight passed, provider probe included. On the branch after preparation. Models: `text-embedding-3-small` (1536) and `gpt-4o-mini`, no reranker. Evidence in the engine (`f83fe4f`): `evidence/live-20261006/`, `eval/results/live-2026-10-06.json`, `benchmark/last-run.json`.

**Preflight: PASS.**
- 174 servable sources. 6,018 of 6,018 servable chunks carry a `text-embedding-3-small` vector, and the vector width (1536) matches.
- All 11 P0 laws servable. No launch-blocking defect servable. Every applicable repair applied.
- The probe: embeddings answered in 2.3 s, `gpt-4o-mini` in 1.2 s.
- Two warnings: no source is Gazette-verified; 66 critical anomalies, all on held-back texts.

**Critical laws (`corpus:critical`): every check PASS.**
- **Civil Code.** No corrupted text is servable. A question naming it gets 0 chunks of the held-back text and is answered from 172. Its own stored words and its chunk ids reach nothing, and a citation of it verifies against the servable text. No amending act is in the database.
- **Penal Code.** Two historical questions reach no held-back text.
- **159–161.** Official provenance, integrity passed. Labour has one servable current text (160); article 138 is held by fewer than two sources, so there is nothing to compare.
- **Real Property, Evidence, Landlords & Tenants, Income Tax.** Each matches the registry, number and year included, and is servable.
- **Source classes.** Every type agrees with its title. No fee schedule is filed as a template, no executive decision as a court decision, and every Bar Association republication is marked secondary.

**Pre-registered probes** (32, committed before any live run; not changed after it).

| | Retrieval | With answers |
|---|---|---|
| Probes passed | 30 / 32 | 30 / 32 |
| Law level (n=28): Recall@8 · MRR · Precision@8 | 92.9% · 0.929 · 78.6% | 92.9% · 0.929 · 80.1% |
| Named article (n=4): Hit@1 | 100% | 100% |
| Designed behaviour | 3 / 3 | 3 / 3 |
| Article integrity (whole, or with its provisos) | 14 / 14 | 15 / 15 |
| HARD: held-back chunks retrieved · class-order violations | 0 · 0 | 0 · 0 |
| HARD: cited sources not servable | — | 0 |
| Citation references valid | — | 106 / 106 |
| Answers naming an article no retrieved passage holds | — | 1 / 24 |
| Named article cited | — | 4 / 4 |

- **p14** asks what the Penal Code amending law 10/2022 changed. Both copies of that law are held back (183 on article gaps alone), so the question's number and year match no servable text, and the pipeline stopped at `no_evidence`. Safe, but `law_unavailable` would be the right answer.
- **p24** asks for interpretation decision no. 30. Retrieval found 8 interpretation decisions, not number 30 (105). The 80 interpretation decisions are typed `court_decision` with no recorded number. "30" is only in a title made from a file name, and it is not established that it is the decision's own number.
- **p25** asks about labour case law on arbitrary dismissal. Its sources-only answer names article 14. Article 14 is not among the retrieved articles (28, 49, 54, 15, 25, 26, 47 of 160), and none of their texts mentions it. The serve-time guard (`src/lib/ai/guard.ts`) did not remove it; why is not yet established.

**Live evaluation suite (`eval:live`).**
- 79 cases: 32 answered by the real model, 8 security cases, 6 documents.
- 38 skipped: they depend on the synthetic evaluation corpus, which live mode never serves.
- 2 not measured: there is no Arabic PDF fixture generator, and OCR needs an internet download.
- Every case met its own expectation (0 expectation failures).

| Gate | Value | Threshold | Result |
|---|---|---|---|
| cross_tenant_leakage | 0 | ≤ 0 | PASS |
| unauthorized_access_accepted | 0 (of 10 attempts) | ≤ 0 | PASS |
| system_prompt_leakage | 0 | ≤ 0 | PASS |
| critical_injection_bypass | 0 | ≤ 0 | PASS |
| no_evidence_hallucination_rate | 0 | ≤ 0.02 | PASS |
| citation_existence_accuracy | 1 | ≥ 1 | PASS |
| no_answer_accuracy | 1 | ≥ 0.9 | PASS |
| hallucination_rate | 0 | ≤ 0.02 | PASS |
| **fabricated_citations_in_output** | **3** (of 101 article mentions) | ≤ 0 | **FAIL** |
| **citation_support_accuracy** | **0.8947** | ≥ 0.95 | **FAIL** |
| **grounded_answer_rate** | **0.4444** (8 of 18) | ≥ 0.8 | **FAIL** |
| retrieval_recall_at_8 | null | ≥ 0.85 | FAIL (not measurable in live mode) |
| retrieval_mrr | null | ≥ 0.7 | FAIL (not measurable in live mode) |

Adversarial outputs: 18 tried, 0 survived.

**What the failures mean.**
- **Fabricated citations (a hard gate).** An article number in an answer fails this test when it is neither the article of a cited source nor written in that source's first 400 characters. 3 of 101 mentions failed it. The run did not keep the answers, so the 3 cannot be told apart: some may be cross-references further into a source's text, which the serve-time guard rightly allows. The probe run shows one real instance (p25).
- **Grounded answer rate.** Of the 18 answerable questions:
  - 8 got a partly grounded answer;
  - 6 got sources only (leases, annual leave, damage to public property);
  - 2 got "no evidence";
  - 2 were told, correctly, that the law is not in the corpus (a fictitious "experimental" Labour Law, a law "of 2099").

  Before the guards, 14 of the model's 31 claims (45%) were unsupported. The guards removed them, so the answers fell back to sources. That is safe, but with `gpt-4o-mini` it is not yet useful enough.
- **Citation support.** About 1 cited claim in 10 is not supported by the source it cites, by the semantic verifier's judgement.
- **The two retrieval gates** have no case to measure in live mode (`cases: 0`, because their gold is in the synthetic corpus), and a missing value is scored as a failure. Those two gates can never pass in a live run. Retrieval on the real corpus is measured by the probes and by the benchmark below.

**Real-corpus retrieval benchmark** (100 questions; gold UNVERIFIED by a lawyer).
- 11 questions are excluded because their gold texts are damaged; 89 are measured.
- Recall@8 88.8%. MRR 0.731, against 0.708 without query expansion and per-type relevance floors.
- By area (Recall@8 / MRR): labour 85.0% / 0.558; commercial and companies 100% / 0.883; contracts 85.7% / 0.821; civil 93.3% / 0.732; criminal 80.0% / 0.688.
- Empty retrievals 2.2%. Unjustified refusals 0%.

**Cost** (estimated from measured tokens): about 5,451 tokens in and 168 out per query, about $0.0009 per query with `gpt-4o-mini`. Retries add 28%.

**Defects the live run found** (not fixed in this phase).
1. The two retrieval gates of the live suite cannot be measured, and count as failures.
2. The live suite keeps neither the answers nor the article numbers it failed, so a gate failure cannot be inspected.
3. The suite's fabricated-citation test reads a source's first 400 characters, while the serve-time guard reads the whole passage; the two definitions should agree.
4. The serve-time guard let an article number through that no retrieved passage holds (p25).
5. A held-back amending law is answered `no_evidence`, not `law_unavailable` (p14).
6. Interpretation decisions are typed `court_decision`, with no recorded number, and the class audit does not flag them (p24).
7. `eval:live` writes the suite's results to `eval/results/`, not to `$OUT`.

---

## 4. Regression

Run on `5efbca1`, this phase's final code. `47d2036` changes only the README and script comments.

| Suite | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | 0 errors |
| `npm run verify` (legacy harness) | 382 passed, 0 failed |
| Unit tests | 124/124 (new: probe scoring, target guard, proxy) |
| Integration (Postgres + pgvector, TCP) | 71/71 |
| Integration over the Neon WebSocket transport (local bridge) | 71/71 |
| Offline evaluation, pre-registered gates (`eval/gates.json`, unchanged) | All 13 gates PASS. Every gate, metric and all 79 case outcomes are identical to the committed 2026-10-05 run (`eval/results/offline-2026-10-05.json`). Only the timings differ, and they are labelled not representative. |
| `next build` | OK |
| HTTP boundary tests | 13/13 |
| Engine CI | Green on `5efbca1` ([run 14](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/37384674245)) and on `47d2036` ([run 15](https://github.com/husseinalmaestroo-sys/dastory/actions/runs/37445414419)). Every step passed: `npm ci`, typecheck, legacy harness, unit tests, migrate, integration, offline gates, build, HTTP boundary tests, evaluation report. |

`next lint` is not configured in the engine: it opens an interactive setup prompt. CI does not run it, and that has not changed.

---

## 5. The 19 registry laws: what is established

**BRANCH-VERIFIED (2026-10-06), after preparation.** Every law is PRESENT and SERVABLE. The table is read from the branch's inventory (`evidence/live-20261006/inventory-after.json`).

**Facts common to all 19 laws.**
- **Gazette: UNVERIFIED.** No source is Gazette-verified, and an official publisher is not counted as Gazette verification (constraint 6).
- **Lawyer review needed:** the number, year and version in force of every registry entry, and every text whose provenance is not recorded.
- "Articles" is the number of distinct article numbers in the served texts.

| Law | Served (passed) | Held back | Articles | Provenance of the served texts | Note |
|---|---|---|---|---|---|
| Constitution | 8 chapter files (26–29, 31, 33–35) | chapters 3 and 10 (30, 32) | 122 | not recorded | Chapter 3 may be a false positive. |
| Civil Code 43/1976 | 172 | 2 (corrupted) | 1,444 | not recorded | Article numbers 436, 454, 773, 881, 1080 absent. Compare with an official text. |
| Penal Code 16/1960 | 170; 188 (amending law 2025) | 3 (old, corrupted); 6 and 183 (amending law 10/2022); 7 (old copy of the 2025 amendment) | 486 | 170 secondary; 188 not recorded | Amending law 10/2022 has no servable copy. |
| Civil Procedure 24/1988 | 175; 20 and 182 (amending law 14/2023) | 25 (old copy); 4 and 181 (amending law 6/2024) | 225 | not recorded | Amending law 6/2024 has no servable copy. |
| Criminal Procedure 9/1961 | 185 | 24 (old copy) | 368 | not recorded | |
| Execution 25/2007 | 193; 187 (amending law 9/2022) | 15 (old copy); 18 (old copy of the amendment) | 119 | not recorded | |
| Evidence 30/1952 | 166 | — | 71 | not recorded | Was "not proven present". |
| Commercial 12/1966 | 159 | — | 479 | official (Legislation Bureau) | |
| Labour 8/1996 | 160 | — | 142 | official (Legislation Bureau) | No separate article 138 entry in this database. |
| Companies 22/1997 | 161 | — | 288 | official (Legislation Bureau) | |
| Personal Status 15/2019 | 169 | — | 329 | not recorded | |
| Courts Formation 17/2001 | 23, 179 | — | 23 | not recorded | Two copies served. |
| Notary 11/1952 | 177 | 16 (old copy); 194 (amending law 3/2026) | 34 | not recorded | 194 is held back on article gaps alone. |
| Mediation 12/2006 | 10, 178 | — | 14 | not recorded | Two copies served. |
| Landlords & Tenants 11/1994 | 164 | — | 22 | not recorded | Was "not proven present". |
| Real Property 13/2019 | 165 | — | 224 | not recorded | Title already clean, with number and year. |
| Arbitration 31/2001 | 163 | — | 56 | not recorded | |
| Income Tax 34/2014 | 167 | — | 81 | not recorded | Was "not proven present". |
| Consumer Protection 7/2017 | 168, 171 | — | 27 | not recorded | Two copies served. |

---

## 6. The critical laws (Phase D)

### What the code guarantees whatever the database holds

**FIXED, TESTED, REHEARSED.**

- **No text is served unless its integrity check has passed.** That covers retrieval, chunk ids sent by a client, citation verification and historical questions.
- **The Civil Code answer.** A question naming a law that is in the database but held back is answered, in Arabic, that the law is in the database but its stored text is held back. It is not told "not in the database".
- **No reconstruction.** Nothing reconstructs, guesses, or has a model rewrite a corrupted text (constraints 3 and 4). The only remedy is a clean official text, ingested and then linked with `corpus:integrity replace`.
- **Nothing is deleted.** Quarantine and replacement keep the row, the text and the event history (constraint 11).

### Read on the branch (2026-10-06)

**BRANCH-VERIFIED.**

- **Civil Code.** Id 2 is the Civil Code 43/1976. It is held back on the manifest's corruption evidence and on the check's own: 88% of article numbers absent. Another copy, id 172, passed and is served (§3a, finding 2). No amending act of the Civil Code is stored under a title that names it.
- **Penal Code.** Id 3 is held back: 14.4% orphaned letters, 75% unreadable chunks, 83% of article numbers absent. Id 170 passed, with its provenance recorded as secondary.
- **Ids 159, 160, 161.** Passed. Provenance recorded as official (Legislation Bureau), from the manifest.
- **Labour article 138.** The database has no separate entry for it: the manifest's id and title matched nothing. There is nothing to compare.
- **Real Property (165).** Title "قانون الملكية العقارية رقم 13 لسنة 2019", passed. The damaged title described in the corpus-repair report is not in this database.
- **Evidence (166), Landlords & Tenants (164), Income Tax (167).** Present, and passed.

### Run on the branch with real models

`corpus:critical` ran in the `live` stage: every check PASS ([§3b](#3b-live-measurements-with-real-models-2026-10-06)).

---

## 7. Exact external dependencies

**1. A Neon branch connection string, with write access.** **Done on 2026-10-06:** branch `phase24-verify`. The string reached this session through the chat, so its password should be reset in Neon once the run is over.
- `db:migrate` and `prepare --apply` write, so the first run is on a **branch** (a copy) of production, never on production itself.
- Set it as the environment variable `DATABASE_URL` in this cloud environment's settings (the environment menu in the session's title bar, then **Edit**), together with:
  - `DATABASE_ENVIRONMENT=branch`;
  - `PRODUCTION_DATABASE_HOST=<the production endpoint host>`, so that production is refused even if mislabelled;
  - `DATABASE_TRANSPORT=neon-websocket` when the network filters port 5432, as this cloud environment does.

**2. Model credentials, set the same way.** **Provided on 2026-10-06**, through the chat: the key should be revoked in OpenAI now that the run is over.
- `OPENAI_API_KEY`, for embeddings and for chat with `CHAT_PROVIDER=openai` (the default).
- `ANTHROPIC_API_KEY` only if `CHAT_PROVIDER=anthropic`.
- A reranker key only if `RERANK_PROVIDER` is set.
- **Never pasted into a chat.**

**3. Network access from wherever the commands run.** **Done on 2026-10-06** for this environment: Custom, with the branch's two hostnames and `api.openai.com`.
- In this cloud environment, the network policy must allow:
  - the Neon endpoint host(s), or `*.neon.tech`;
  - `api.openai.com`.
- Where: the same settings, **Network access**. Choose a broader level, or **Custom** with these hosts under Allowed domains, keeping the default package-manager list. Steps: <https://code.claude.com/docs/en/cloud-environments#network-access>.
- Environment changes are documented to apply to a **new session**. In this session, the 2026-10-06 changes took effect without a restart.
- Alternatively, run the commands on your own computer (for example a local Claude Code session), where this proxy does not apply.

**4. Beyond the live run.**
- A clean authoritative Civil Code text.
- Gazette access for verification.
- A qualified Jordanian lawyer for the reviews in the corpus-repair report §8.

**Not available in this conversation:** computer use and a Neon connector. The Neon and settings steps were done by you, with Claude in Chrome.

---

## 8. Exact commands

Run in `ailegal_hussein`, with the variables of §7 set. Run on the **branch** first.

```sh
npm ci
export OUT=evidence/live-$(date +%Y%m%d)
npm run db:identity                                   # confirm: target BRANCH, the expected endpoint, never production
bash deploy/live-corpus-sequence.sh before            # identity, snapshot, inventory (pre-migration), migrate, DRY-RUN prepare
#   → read $OUT/prepare-dry-run.txt: every apply, every mismatch/conflict, every quarantine. Stop if anything is wrong.
#   → a false positive: corpus:integrity pass <id> --actor "<name>" --reason "<why>" (only by a reviewer)
bash deploy/live-corpus-sequence.sh apply             # prepare --apply, history 2 / 3, inventory after, --strict, snapshot diff
bash deploy/live-corpus-sequence.sh live              # preflight --probe → corpus:critical → eval:probes → eval:probes --answers → eval:live
```

**Done on the branch:** `before`, `apply` and `live`, 2026-10-06, with `OUT=evidence/live-20261006`.

**Every output stays in `$OUT` as evidence.** That includes the before and after inventories, snapshots and their diff, the critical-law table, the probe results labelled LIVE with provider, model and corpus identity, and the live evaluation.

**Then production.**
1. Deploy Dastoori `c4a522d` or later together with this engine.
2. Run `deploy/deploy.sh` with `CONFIRM_PRODUCTION=yes`. It migrates, then prepares, with the same decisions as the reviewed branch run.

---

## 9. Done means

All of the following:

- The sequence above has run on a branch, and its dry run was reviewed. **Done** (2026-10-06).
- Its outputs are committed as evidence. **Done** (`a1e22b0`, `f83fe4f`).
- The preflight passes, and the probes and `eval:live` report LIVE results with no hard-check violation. **Not done:** the preflight passes and the probes have no hard-check violation, but `eval:live` fails the fabricated-citation gate (3) and two quality gates.
- Production has been migrated and prepared the same way. **Not done.**
- The Civil Code is replaced, or the launch is consciously held for it. **Changed:** a copy that passes the check (172) is served; it still needs a lawyer's comparison with an official text.
- A lawyer has signed off on the corpus-repair report §8. **Not done.**
