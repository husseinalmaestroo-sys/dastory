import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeInventory, type InventoryChunks, type InventorySource, type RequiredLaw } from "@/lib/corpus/inventory";
import { evaluatePreflight, loadPreflightDb, preflightText, redact, type PreflightDb } from "@/lib/eval/live-preflight";

/**
 * Phase 2.1 live-evaluation preflight: what makes an environment one where a
 * "live" result means something — and that nothing short of it passes.
 */

const LABOUR: RequiredLaw = { id: "labour", name: "قانون العمل", kind: "قانون", number: "8", year: 1996, priority: "P0", category: "عمل", basis: "test" };
const TEXT = "المادة 1 يسمى هذا القانون قانون العمل ويعمل به بعد مرور ثلاثين يوما على تاريخ نشره في الجريدة الرسمية. ".repeat(20);

const source = (over: Partial<InventorySource> = {}): InventorySource => ({
  id: 1,
  title: "قانون العمل رقم 8 لسنة 1996",
  source_type: "law",
  status: "ready",
  jurisdiction: "JO",
  language: "ar",
  provenance: "official",
  source_url: "https://example.invalid/labour.pdf",
  issuing_authority: null,
  integrity_status: "unverified",
  is_current_version: true,
  supersedes: null,
  amendment_of: null,
  replaced_by: null,
  law_number: "8",
  effective_date: "1996-06-01",
  file_hash: "h1",
  chunk_count: 10,
  is_synthetic: false,
  ...over,
});
const chunks = (over: Partial<InventoryChunks> = {}): InventoryChunks => ({
  source_id: 1,
  chunks: 10,
  embedded: 10,
  models: [],
  articles: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  sample_text: TEXT,
  ...over,
});
const db = (sources: InventorySource[], rows: InventoryChunks[], over: Partial<Extract<PreflightDb, { ok: true }>> = {}): PreflightDb => ({
  ok: true,
  schemaMissing: [],
  vectorDim: 1536,
  testVectorChunks: 0,
  inventory: analyzeInventory({ sources, chunks: rows, orphanChunks: 0, registry: [LABOUR], servedModel: "text-embedding-3-small", includeSynthetic: false }),
  ...over,
});

const SECRET_A = "sk-ant-api03-DONOTPRINTaaaaaaaa";
const SECRET_O = "sk-proj-DONOTPRINTbbbbbbbb";
const REAL_ENV = { CHAT_PROVIDER: "anthropic", ANTHROPIC_API_KEY: SECRET_A, EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: SECRET_O };
const failing = (r: ReturnType<typeof evaluatePreflight>) => r.checks.filter((c) => c.blocking && !c.ok).map((c) => c.id).sort();

test("a real corpus with real providers passes; untagged vectors count as the legacy model, as retrieval treats them", () => {
  const r = evaluatePreflight({ env: REAL_ENV, db: db([source()], [chunks()]) });
  assert.deepEqual(failing(r), []);
  assert.equal(r.ok, true);
  assert.equal(r.corpus!.visibleChunks, 10);
  // Findings, not blockers: no verified official text yet.
  assert.equal(r.checks.find((c) => c.id === "authoritative")!.ok, false);
  assert.equal(r.checks.find((c) => c.id === "authoritative")!.blocking, false);
});

test("the deterministic test providers block, whatever the corpus", () => {
  const r = evaluatePreflight({ env: { CHAT_PROVIDER: "test", EMBEDDING_PROVIDER: "test" }, db: db([source()], [chunks()]) });
  assert.equal(r.ok, false);
  assert.deepEqual(failing(r), ["chat_provider", "embedding_provider"]);
});

test("a database holding only synthetic fixtures blocks: not the production corpus", () => {
  const fixture = source({ is_synthetic: true, provenance: "synthetic", title: "قانون العمل التجريبي رقم 8 لسنة 1996" });
  const r = evaluatePreflight({ env: REAL_ENV, db: db([fixture], [chunks()]) });
  assert.equal(r.ok, false);
  assert.deepEqual(failing(r), ["embedding_model", "p0_any", "real_corpus"]);
});

test("test-model vectors in a non-synthetic source block (test data, and invisible to the real query model)", () => {
  const r = evaluatePreflight({ env: REAL_ENV, db: db([source()], [chunks({ models: ["test-hash-embed-v1"] })], { testVectorChunks: 10 }) });
  assert.deepEqual(failing(r), ["embedding_model", "no_test_vectors"]);
});

test("the served embedding model must see at least 90% of servable chunks", () => {
  const two = [source(), source({ id: 2, title: "قانون التجارة رقم 12 لسنة 1966", file_hash: "h2", chunk_count: 100 })];
  // `visible` of 110 chunks carry the served model's vectors; the rest another model's.
  const at = (visible: number) =>
    evaluatePreflight({
      env: REAL_ENV,
      db: db(two, [
        chunks({ chunks: 110 - visible, embedded: 110 - visible, models: ["text-embedding-3-large"] }),
        chunks({ source_id: 2, chunks: visible, embedded: visible, models: ["text-embedding-3-small"] }),
      ]),
    });
  assert.equal(at(99).checks.find((c) => c.id === "embedding_model")!.ok, true, "99 of 110 = 90%");
  assert.equal(at(98).checks.find((c) => c.id === "embedding_model")!.ok, false, "98 of 110 < 90%");
  // A wrong EMBEDDING_MODEL setting makes the whole corpus invisible.
  const wrong = evaluatePreflight({ env: { ...REAL_ENV, EMBEDDING_MODEL: "text-embedding-3-large" }, db: db([source()], [chunks()]) });
  assert.deepEqual(failing(wrong), ["embedding_model"]);
});

test("a missing key blocks, and no key's value is ever printed", () => {
  const missing = evaluatePreflight({ env: { ...REAL_ENV, ANTHROPIC_API_KEY: "" }, db: db([source()], [chunks()]) });
  assert.deepEqual(failing(missing), ["chat_key"]);
  const ok = evaluatePreflight({ env: REAL_ENV, db: db([source()], [chunks()]) });
  const printed = preflightText(ok) + JSON.stringify(ok);
  assert.ok(!printed.includes("DONOTPRINT"), printed);
  assert.match(printed, /ANTHROPIC_API_KEY is set/);
});

test("retrieval-only runs: chat problems are reported, not blocking; embeddings still are", () => {
  const r = evaluatePreflight({ env: { CHAT_PROVIDER: "test", EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: SECRET_O }, db: db([source()], [chunks()]), needChat: false });
  assert.equal(r.ok, true);
  assert.equal(r.checks.find((c) => c.id === "chat_provider")!.ok, false);
  const noEmbeddingKey = evaluatePreflight({ env: { EMBEDDING_PROVIDER: "voyage" }, db: db([source()], [chunks()]), needChat: false });
  assert.deepEqual(failing(noEmbeddingKey), ["embedding_key"]);
});

test("serving fixtures, a vector-width mismatch, an unmigrated schema and a keyless reranker each block", () => {
  const base = { env: REAL_ENV, db: db([source()], [chunks()]) };
  assert.deepEqual(failing(evaluatePreflight({ ...base, env: { ...REAL_ENV, ALLOW_SYNTHETIC_CORPUS: "true" } })), ["synthetic_corpus_off"]);
  assert.deepEqual(failing(evaluatePreflight({ ...base, env: { ...REAL_ENV, EMBEDDING_DIM: "1024" } })), ["vector_width"]);
  assert.deepEqual(failing(evaluatePreflight({ ...base, db: db([source()], [chunks()], { schemaMissing: ["maintenance_runs"] }) })), ["schema"]);
  assert.deepEqual(failing(evaluatePreflight({ ...base, env: { ...REAL_ENV, RERANK_PROVIDER: "cohere" } })), ["rerank_key"]);
});

test("an unreachable database blocks without echoing its credentials", async () => {
  const down = { query: async () => Promise.reject(new Error("connect failed for postgres://neondb_owner:npg_DONOTPRINT@ep-x.neon.tech/neondb\nstack")) };
  const d = await loadPreflightDb(down, REAL_ENV, "deploy/sources/required-laws.json");
  assert.equal(d.ok, false);
  const r = evaluatePreflight({ env: REAL_ENV, db: d });
  assert.equal(r.ok, false);
  assert.deepEqual(failing(r), ["database"]);
  assert.ok(!JSON.stringify(r).includes("DONOTPRINT"), JSON.stringify(r));
  assert.equal(redact(`bad key ${SECRET_O}`).includes("DONOTPRINT"), false);
});
