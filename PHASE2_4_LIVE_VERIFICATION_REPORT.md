# Phase 2.4: Live corpus verification report

**Date:** 2026-10-05 to 2026-10-06.

**Commits.**
- Engine `ailegal_hussein`: `c9793d0` (the pre-registered probes, committed alone and before any live run), then `5efbca1` (this phase's tooling), then `47d2036` (README and script comments only: when the guard refuses). Branch `claude/ailegal-hussein-phase2`, parent `901ef9f`.
- Dastoori: the commit carrying this report, branch `claude/hopeful-ritchie-gip3i7` (parent `01b22a7`). No Dastoori code changed in this phase.

## Verdict

**Not LIVE-CORPUS-VERIFIED. Not REAL-MODEL-VALIDATED.**

- Phase A (pre-flight) ran.
- Phases B to G did not run against the production corpus, against a copy of it, or against real models. Each is **BLOCKED BY EXTERNAL DEPENDENCY**.
- The blockers in [§1](#1-phase-a-pre-flight-executed) were checked in this environment, not assumed.
- Everything that does not depend on them was built, tested, and rehearsed end to end on a production-shaped stand-in database ([§3](#3-rehearsal-on-a-production-shaped-stand-in)).
- The live work is now one reviewed command sequence ([§8](#8-exact-commands)).

**No number in this report measures the real corpus.**

**Status words.**
- **FIXED**: the code or data was changed.
- **TESTED**: a test exercises the change and passes.
- **REHEARSED**: run end to end on the stand-in database of §3. Its texts are invented placeholders. It proves the procedure works and measures nothing about the corpus.
- **UNVERIFIED**: no evidence yet on the production corpus or with real models.
- **BLOCKED BY EXTERNAL DEPENDENCY**: cannot advance without something named in [§7](#7-exact-external-dependencies).

---

## 1. Phase A: pre-flight (executed)

| Check | Result |
|---|---|
| Engine repository | Branch `claude/ailegal-hussein-phase2`. Parent `901ef9f` had a green CI run. This phase is commits `c9793d0`, `5efbca1` and `47d2036`. |
| Dastoori repository | Branch `claude/hopeful-ritchie-gip3i7` at `01b22a7`, plus this report. |
| `DATABASE_URL` | **Absent** from this session. No `.env` file (the engine has only `.env.example`). |
| `DATABASE_ENVIRONMENT`, `PRODUCTION_DATABASE_HOST`, `DATABASE_TRANSPORT` | Absent. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `VOYAGE_API_KEY` | **Absent.** Checked by name only; no value was read or printed. |
| Network to Neon | The environment's egress proxy refuses `console.neon.tech:443` and a Neon endpoint host (`*.aws.neon.tech:443`) with HTTP 403: no allowlist rule. Direct TCP to port 5432 times out (filtered). The policy was not routed around. |
| Network to OpenAI | The proxy refuses `api.openai.com:443`. The engine's own provider probe, sent through the proxy, reports `403 request blocked: no rule or allowlist entry allows host "api.openai.com"`. |
| Network to Anthropic | `api.anthropic.com` is on the proxy's bypass list, but no key is set. No call was attempted. |
| Neon from the desktop | No Neon connector is attached to this session. Computer use (operating the Neon console on your computer) is not available in this conversation. |
| Database identity, migration version | **Not readable: there is no target.** `npm run db:identity` now prints both on any schema ([§2](#2-what-was-built-in-this-phase), A-2). This checkout's schema fingerprint is `01541b3d842852ae…` (sha256 of `db/schema.sql`). |
| Engine ↔ Dastoori compatibility | Unchanged: no API shape changed in this phase. Pairing still requires Dastoori `c4a522d` or later with engine `901ef9f` or later (the `law_unavailable` mode). |
| `npm ci` | The lockfile carries the new dependencies. CI's `npm ci` passed on `5efbca1`. |
| `npm run db:migrate` on Neon | **Not run.** There is no target, and the rule is to migrate only after confirming a branch. The migration now enforces that rule itself (A-1). |

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

**No law is DATABASE VERIFIED. This database was never read.**

The **Repository evidence** column records what the repository shows, as in the corpus-repair report §5. "Retrieved" means the law appears in a saved historical retrieval result. **That is not proof that it is in the database today** (constraint 5).

**Facts common to all 19 laws.**
- **Gazette: UNVERIFIED.** No source anywhere is Gazette-verified, and an official publisher is not counted as Gazette verification (constraint 6).
- **Lawyer review needed:** the number, year and version in force of every registry entry.

| Law | No./year (where copied from) | Repository evidence | Will be decided by the live run |
|---|---|---|---|
| Constitution | — (Ministry list) | LISTED FOR INGESTION only | Present? Do its chapter files pass the integrity check? |
| Civil Code | 43/1976 (Ministry file name) | PRESENT / RETRIEVED HISTORICALLY. **Corrupted.** The manifest quarantines id 2. | Expected PRESENT BUT QUARANTINED. A replacement is needed. |
| Penal Code | 16/1960 (Ministry) | RETRIEVED. Id 170 is secondary. Id 3 is corrupted and the manifest quarantines it. | Is id 170 servable as secondary? Is id 3 quarantined? |
| Civil Procedure | 24/1988 (Ministry) | RETRIEVED | State |
| Criminal Procedure | 9/1961 (Ministry) | RETRIEVED | State |
| Execution | 25/2007 (Ministry) | LISTED FOR INGESTION only | Present? |
| Evidence | 30/1952 (guidance list) | **NOT PROVEN PRESENT** | Present, absent, under another title, or quarantined (`corpus:critical`) |
| Commercial | 12/1966 (guidance) | RETRIEVED (id 159, Legislation Bureau per the record) | Provenance and integrity of id 159 |
| Labour | 8/1996 (guidance) | RETRIEVED (id 160). Article 138 entered by hand. | Article 138 compared text against text |
| Companies | 22/1997 (guidance) | RETRIEVED (id 161) | Provenance and integrity of id 161 |
| Personal Status | 15/2019 (guidance; amended) | RETRIEVED | Number, year and version |
| Courts Formation | 17/2001 (Ministry) | LISTED FOR INGESTION only | Present? |
| Notary | 11/1952 (Ministry) | LISTED FOR INGESTION only | Present? |
| Mediation | 12/2006 (Ministry) | LISTED FOR INGESTION only | Present? |
| Landlords & Tenants | 11/1994 (guidance) | **NOT PROVEN PRESENT** | As for Evidence |
| Real Property | 13/2019 (guidance only) | RETRIEVED under a damaged title. **METADATA INCOMPLETE.** | Title repaired. Number and year stay empty until official evidence. |
| Arbitration | 31/2001 (guidance) | RETRIEVED | State |
| Income Tax | 34/2014 (guidance) | **NOT PROVEN PRESENT** | As for Evidence |
| Consumer Protection | 7/2017 (guidance) | RETRIEVED | State |

---

## 6. The critical laws (Phase D)

### What the code guarantees whatever the database holds

**FIXED, TESTED, REHEARSED.**

- **No text is served unless its integrity check has passed.** That covers retrieval, chunk ids sent by a client, citation verification and historical questions.
- **The Civil Code answer.** A question naming a law that is in the database but held back is answered, in Arabic, that the law is in the database but its stored text is held back. It is not told "not in the database".
- **No reconstruction.** Nothing reconstructs, guesses, or has a model rewrite a corrupted text (constraints 3 and 4). The only remedy is a clean official text, ingested and then linked with `corpus:integrity replace`.
- **Nothing is deleted.** Quarantine and replacement keep the row, the text and the event history (constraint 11).

### Still to be read from the database

Run `corpus:critical` and `corpus:inventory` on the branch. **BLOCKED BY EXTERNAL DEPENDENCY.**

- **Civil Code.**
  - Is id 2 still the Civil Code, and what is its corruption ratio?
  - Is there a clean text, or an amending act?
  - Do any of the routes listed in §2 reach it?
- **Penal Code.**
  - The state and provenance of ids 3 and 170.
  - Does a historical question reach id 3?
- **Ids 159, 160, 161.** Their provenance as stored.
- **Labour article 138.** Is source 200 the same text as article 138 of id 160 (identical, contained, or different)? This is not guessed: the command compares the stored texts.
- **Real Property.**
  - The stored title, number, year and version.
  - The number and year are added only from official evidence.
- **Evidence, Landlords & Tenants, Income Tax.**
  - Present, absent, under a different title, or quarantined: in any status, and by a loose name match too.

---

## 7. Exact external dependencies

**1. A Neon branch connection string, with write access.**
- `db:migrate` and `prepare --apply` write, so the first run is on a **branch** (a copy) of production, never on production itself.
- Set it as the environment variable `DATABASE_URL` in this cloud environment's settings (the environment menu in the session's title bar, then **Edit**), together with:
  - `DATABASE_ENVIRONMENT=branch`;
  - `PRODUCTION_DATABASE_HOST=<the production endpoint host>`, so that production is refused even if mislabelled;
  - `DATABASE_TRANSPORT=neon-websocket` when the network filters port 5432, as this cloud environment does.

**2. Model credentials, set the same way.**
- `OPENAI_API_KEY`, for embeddings and for chat with `CHAT_PROVIDER=openai`.
- `ANTHROPIC_API_KEY` only if `CHAT_PROVIDER=anthropic`.
- A reranker key only if `RERANK_PROVIDER` is set.
- **Never pasted into a chat.**

**3. Network access from wherever the commands run.**
- In this cloud environment, the network policy must allow:
  - the Neon endpoint host(s), or `*.neon.tech`;
  - `api.openai.com`.
- Where: the same settings, **Network access**. Choose a broader level, or **Custom** with these hosts under Allowed domains, keeping the default package-manager list. Steps: <https://code.claude.com/docs/en/cloud-environments#network-access>.
- Environment changes apply to a **new session**.
- Alternatively, run the commands on your own computer (for example a local Claude Code session), where this proxy does not apply.

**4. Beyond the live run.**
- A clean authoritative Civil Code text.
- Gazette access for verification.
- A qualified Jordanian lawyer for the reviews in the corpus-repair report §8.

**Not available in this conversation:** computer use, which would be needed to operate the Neon console on your desktop, and a Neon connector.

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

**Every output stays in `$OUT` as evidence.** That includes the before and after inventories, snapshots and their diff, the critical-law table, the probe results labelled LIVE with provider, model and corpus identity, and the live evaluation.

**Then production.**
1. Deploy Dastoori `c4a522d` or later together with this engine.
2. Run `deploy/deploy.sh` with `CONFIRM_PRODUCTION=yes`. It migrates, then prepares, with the same decisions as the reviewed branch run.

---

## 9. Done means

All of the following:

- The sequence above has run on a branch, and its dry run was reviewed.
- Its outputs are committed as evidence.
- The preflight passes, and the probes and `eval:live` report LIVE results with no hard-check violation.
- Production has been migrated and prepared the same way.
- The Civil Code is replaced, or the launch is consciously held for it.
- A lawyer has signed off on the corpus-repair report §8.

**None of this has happened yet.**
