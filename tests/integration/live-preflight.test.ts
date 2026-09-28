import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useTestEnv } from "./helpers";
import { getPool, query, queryOne } from "@/lib/db";
import { loadEvalFixtures } from "../../scripts/load-eval-fixtures";
import { ingestSource } from "@/lib/ingest/pipeline";
import { evaluatePreflight, loadPreflightDb } from "@/lib/eval/live-preflight";

/**
 * Phase 2.1: the live evaluation refuses anything that is not a live
 * environment — here, against the real schema: the synthetic test database,
 * test-model vectors, and the scripts themselves run as an operator would.
 */
useTestEnv();

const ROOT = resolve(__dirname, "../..");
const REGISTRY = resolve(ROOT, "deploy/sources/required-laws.json");
// What an operator's environment would claim; the keys are placeholders and no call is made.
const LIVE_ENV = { CHAT_PROVIDER: "openai", EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "sk-placeholder-not-a-real-key" };
const dir = mkdtempSync(join(tmpdir(), "preflight-test-"));
const created: number[] = [];

before(async () => {
  await loadEvalFixtures({ quiet: true });
});
after(async () => {
  if (created.length) await query(`DELETE FROM legal_sources WHERE id = ANY($1::bigint[])`, [created]);
  rmSync(dir, { recursive: true, force: true });
  await getPool().end();
});

const blocking = (r: ReturnType<typeof evaluatePreflight>) => r.checks.filter((c) => c.blocking && !c.ok).map((c) => c.id).sort();

test("the test database is refused for a live run: it holds synthetic fixtures, not the production corpus", async () => {
  const r = evaluatePreflight({ env: LIVE_ENV, db: await loadPreflightDb(getPool(), LIVE_ENV, REGISTRY) });
  assert.equal(r.ok, false);
  assert.deepEqual(blocking(r), ["embedding_model", "p0_any", "real_corpus"]);
  // The rest of the environment is fine — it is the corpus that is not real.
  assert.equal(r.checks.find((c) => c.id === "schema")!.ok, true);
  assert.equal(r.checks.find((c) => c.id === "vector_width")!.ok, true);
});

test("the one-command runner and every live script refuse the synthetic database — exit 2, nothing measured, nothing written", () => {
  const results = mkdtempSync(join(tmpdir(), "preflight-results-"));
  const lastRun = resolve(ROOT, "benchmark/last-run.json");
  const before = existsSync(lastRun) ? statSync(lastRun).mtimeMs : null;
  const liveResults = () => readdirSync(resolve(ROOT, "eval/results")).filter((f) => f.startsWith("live-"));
  const liveBefore = liveResults();
  // Only what an operator would set: nothing of this process's own environment leaks in.
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: process.env.DATABASE_URL,
    EVAL_RESULTS_DIR: results,
    ...LIVE_ENV,
  };
  const tsx = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");
  for (const [script, args] of [
    ["scripts/eval-live.ts", []],
    ["scripts/eval.ts", ["--mode", "live"]],
    ["scripts/benchmark.ts", []],
    ["scripts/live-preflight.ts", []],
  ] as const) {
    const r = spawnSync(process.execPath, [tsx, "--tsconfig", "scripts/tsconfig.verify.json", script, ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 2, `${script} exit ${r.status}:\n${out}`);
    assert.match(out, /Preflight: BLOCKED/, script);
    assert.match(out, /real_corpus .*\[BLOCKING\]/, script);
    assert.ok(!out.includes("sk-placeholder-not-a-real-key"), `${script} printed a key`);
    assert.ok(!/evaluation \(live\) →|live evaluation: suite exit/.test(out), `${script} ran past the preflight`);
  }
  assert.deepEqual(liveResults(), liveBefore, "no live result file in eval/results");
  assert.equal(existsSync(lastRun) ? statSync(lastRun).mtimeMs : null, before, "benchmark/last-run.json untouched");
  // The runner keeps the refusal as evidence, in the directory it was given.
  assert.deepEqual(readdirSync(results).filter((f) => f.startsWith("live-preflight-")).length, 1);
  rmSync(results, { recursive: true, force: true });
});

test("a non-synthetic law embedded by the test model is refused; the same law with production-model vectors passes", async () => {
  const title = "قانون العمل رقم 8 لسنة 1996";
  const row = await queryOne<{ id: string }>(
    `INSERT INTO legal_sources (title, source_type, status, effective_date, is_current_version, jurisdiction, language, provenance, source_url, is_synthetic, integrity_status)
     VALUES ($1, 'law', 'pending', '1996-06-01', true, 'JO', 'ar', 'official', 'https://example.invalid/labour-8-1996.pdf', false, 'unverified') RETURNING id`,
    [title]
  );
  const id = Number(row!.id);
  created.push(id);
  const file = join(dir, `${id}.txt`);
  const articles = Array.from({ length: 12 }, (_, i) => `المادة ${i + 1}\nيلتزم صاحب العمل بأحكام هذا القانون في شأن العامل وفق ما تنص عليه هذه المادة ${i + 1} من أحكام وشروط.`).join("\n\n");
  writeFileSync(file, `${title}\n\n${articles}`, "utf8");
  await ingestSource({ sourceId: id, filePath: file, title, sourceType: "law", court: null, year: null });

  const testVectors = evaluatePreflight({ env: LIVE_ENV, db: await loadPreflightDb(getPool(), LIVE_ENV, REGISTRY) });
  assert.deepEqual(blocking(testVectors), ["embedding_model", "no_test_vectors"], JSON.stringify(testVectors.checks));
  assert.equal(testVectors.corpus!.p0Servable, 1);

  // Vectors from the production embedding model — tagged, then untagged (stored before Phase 2 recorded the model).
  for (const model of ["text-embedding-3-small", null]) {
    await query(`UPDATE legal_documents SET embedding_model = $2 WHERE source_id = $1`, [id, model]);
    const r = evaluatePreflight({ env: LIVE_ENV, db: await loadPreflightDb(getPool(), LIVE_ENV, REGISTRY) });
    assert.deepEqual(blocking(r), [], `${model ?? "untagged"}: ${JSON.stringify(r.checks)}`);
    assert.equal(r.ok, true);
    assert.equal(r.corpus!.visibleChunks, r.corpus!.servableChunks);
    // Still reported: ten P0 laws missing, no verified official text.
    assert.equal(r.checks.find((c) => c.id === "p0_all")!.ok, false);
    assert.equal(r.checks.find((c) => c.id === "authoritative")!.ok, false);
  }
  // …and a live run with the test providers is still refused on that corpus.
  const testProviders = evaluatePreflight({ env: { ...LIVE_ENV, CHAT_PROVIDER: "test", EMBEDDING_PROVIDER: "test" }, db: await loadPreflightDb(getPool(), LIVE_ENV, REGISTRY) });
  assert.deepEqual(blocking(testProviders), ["chat_provider", "embedding_provider"]);
});
