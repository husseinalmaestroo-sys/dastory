import "server-only";
import { analyzeInventory, loadInventoryInput, loadRegistry, type InventoryReport } from "../corpus/inventory";
import { DEFAULT_REPAIRS_PATH, loadRepairManifest, loadRepairRows, planRepairs, servingBlockers, type RepairPlanRow } from "../corpus/repairs";

/**
 * Live-evaluation preflight (Phase 2.1).
 *
 * A result labelled "live" must come from real models over the real corpus.
 * `npm run eval:live`, `scripts/eval.ts --mode live` and the real-corpus
 * benchmark run this first and refuse to start when it blocks — so a
 * synthetic or test database, the deterministic test providers, or a missing
 * key can never be reported as a live measurement. Read-only. Key VALUES are
 * never read out, only whether each is set.
 *
 * Blocking (fixed here before any live run; not tuned to a result):
 *   providers  chat and embedding providers are real (not "test"), each one's
 *              key is set, and a configured reranker has its key (the chat
 *              checks only when the run generates answers);
 *   corpus     ALLOW_SYNTHETIC_CORPUS is off; the database is reachable and
 *              migrated; EMBEDDING_DIM matches the vector column; it serves at
 *              least one non-synthetic source; no non-synthetic chunk carries
 *              a test-model vector; at least 90% of servable chunks carry a
 *              vector of the served embedding model (the rest are invisible
 *              to retrieval); at least one P0 law of the registry is servable;
 *   repair     (corpus repair, 2026-10) every ready non-synthetic source has
 *              been through the integrity check (none 'unchecked'); every
 *              applicable entry of the known-defect manifest
 *              (deploy/sources/corpus-repairs.json) is applied; and no
 *              launch-blocking defect — the corrupted Civil Code, the old
 *              corrupted Penal Code — can still be served. The remedy for all
 *              three is `npm run corpus:integrity -- prepare --apply`.
 * Reported, not blocking: P0 laws that are not servable, zero Gazette-verified
 * sources, manifest entries that need a reviewer (conflict, mismatch, review),
 * critical inventory anomalies — findings about the corpus the live run should
 * measure, not reasons to skip measuring it.
 */

/** Share of servable chunks that must be visible to the served embedding model. */
export const MIN_VISIBLE_CHUNK_RATIO = 0.9;

const CHAT_KEYS: Record<string, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const EMBEDDING_KEYS: Record<string, string> = { openai: "OPENAI_API_KEY", voyage: "VOYAGE_API_KEY" };
const RERANK_KEYS: Record<string, string> = { cohere: "COHERE_API_KEY", voyage: "VOYAGE_API_KEY" };

/** What the schema must have for the Phase 2.1 pipeline (table or table.column). */
export const REQUIRED_SCHEMA = [
  "legal_sources.integrity_status",
  "legal_sources.gazette_status",
  "legal_sources.is_synthetic",
  "legal_sources.provenance",
  "legal_documents.embedding_model",
  "ai_requests.stage_ms",
  "corpus_integrity_events",
  "corpus_integrity_events.kind",
  "maintenance_runs",
] as const;

export type PreflightDb =
  | {
      ok: true;
      /** REQUIRED_SCHEMA entries that are absent. */
      schemaMissing: string[];
      /** Width of legal_documents.embedding (null when unknown). */
      vectorDim: number | null;
      inventory: InventoryReport;
      /** Chunks of non-synthetic sources embedded by a test model. */
      testVectorChunks: number;
      /** The known-defect manifest against this database, or why it could not be read. */
      repairs: PreflightRepairs;
    }
  | { ok: false; error: string };

export type PreflightRepairs =
  | {
      ok: true;
      /** The manifest's plan for this database (corpus/repairs.ts planRepairs). */
      plan: RepairPlanRow[];
      /** Launch-blocking defects still servable (or unconfirmable). */
      blockers: { id: string; sourceId: number | null; detail: string }[];
    }
  | { ok: false; error: string };

export type PreflightInput = {
  env: Readonly<Record<string, string | undefined>>;
  db: PreflightDb;
  /** False for retrieval-only runs: chat provider problems are then reported, not blocking. Default true. */
  needChat?: boolean;
};

export type PreflightCheck = { id: string; blocking: boolean; ok: boolean; detail: string };

export type PreflightResult = {
  ok: boolean;
  checks: PreflightCheck[];
  corpus: {
    servableSources: number;
    servableChunks: number;
    visibleChunks: number;
    /** Ready non-synthetic sources never checked — not served. */
    uncheckedSources: number;
    /** Sources the integrity check or a reviewer quarantined, and replaced ones — kept, never served. */
    heldBackSources: number;
    gazetteVerifiedSources: number;
    authoritativeSources: number;
    p0Laws: number;
    p0Servable: number;
    p0Missing: string[];
    criticalAnomalies: number;
  } | null;
  servedEmbeddingModel: string;
};

const isSet = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const e = input.env;
  const needChat = input.needChat ?? true;
  const checks: PreflightCheck[] = [];
  const add = (id: string, blocking: boolean, ok: boolean, detail: string) => checks.push({ id, blocking, ok, detail });

  // ---- providers
  const chat = e.CHAT_PROVIDER ?? "openai";
  const chatKey = CHAT_KEYS[chat];
  add("chat_provider", needChat, !!chatKey, chatKey ? `CHAT_PROVIDER=${chat}` : `CHAT_PROVIDER=${chat} is not a real provider (openai | anthropic)`);
  if (chatKey) add("chat_key", needChat, isSet(e[chatKey]), `${chatKey} ${isSet(e[chatKey]) ? "is set" : "is missing"}`);

  const embedding = e.EMBEDDING_PROVIDER ?? "openai";
  const embeddingKey = EMBEDDING_KEYS[embedding];
  add(
    "embedding_provider",
    true,
    !!embeddingKey,
    embeddingKey ? `EMBEDDING_PROVIDER=${embedding}` : `EMBEDDING_PROVIDER=${embedding} is not a real provider (openai | voyage)`
  );
  if (embeddingKey) add("embedding_key", true, isSet(e[embeddingKey]), `${embeddingKey} ${isSet(e[embeddingKey]) ? "is set" : "is missing"}`);

  const rerank = e.RERANK_PROVIDER ?? "none";
  if (rerank !== "none") {
    const rerankKey = RERANK_KEYS[rerank];
    add(
      "rerank_key",
      true,
      !!rerankKey && isSet(e[rerankKey]),
      rerankKey ? `RERANK_PROVIDER=${rerank}: ${rerankKey} ${isSet(e[rerankKey]) ? "is set" : "is missing"}` : `RERANK_PROVIDER=${rerank} is unknown`
    );
  }

  // ---- corpus
  add(
    "synthetic_corpus_off",
    true,
    e.ALLOW_SYNTHETIC_CORPUS !== "true",
    e.ALLOW_SYNTHETIC_CORPUS === "true" ? "ALLOW_SYNTHETIC_CORPUS=true: evaluation fixtures would be served as law" : "evaluation fixtures are not served"
  );

  const served = e.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const legacy = e.LEGACY_EMBEDDING_MODEL ?? "text-embedding-3-small";
  if (!input.db.ok) {
    add("database", true, false, `database unreachable: ${input.db.error}`);
    return { ok: false, checks, corpus: null, servedEmbeddingModel: served };
  }
  const { inventory, schemaMissing, testVectorChunks, vectorDim } = input.db;
  add("database", true, true, "reachable");
  add("schema", true, schemaMissing.length === 0, schemaMissing.length ? `not migrated (missing ${schemaMissing.join(", ")}) — run npm run migrate` : "migrated");
  const dim = Number(e.EMBEDDING_DIM ?? 1536);
  add("vector_width", true, vectorDim !== null && vectorDim === dim, `EMBEDDING_DIM ${dim}, vector column ${vectorDim ?? "unknown"}`);

  const servable = inventory.sources.filter((s) => s.servable);
  const real = servable.filter((s) => !s.is_synthetic);
  const readyReal = inventory.sources.filter((s) => !s.is_synthetic && s.status === "ready");
  const unchecked = readyReal.filter((s) => s.integrity_status === "unchecked");
  const heldBack = readyReal.filter((s) => s.integrity_status === "quarantined" || s.integrity_status === "replaced");
  add(
    "real_corpus",
    true,
    real.length > 0,
    real.length > 0
      ? `${real.length} non-synthetic servable source(s)`
      : readyReal.length > 0
        ? `none of the ${readyReal.length} non-synthetic source(s) has passed the integrity check — nothing is served until it has: npm run corpus:integrity -- prepare --apply`
        : "no non-synthetic servable source: this is a synthetic or empty database, not the production corpus"
  );
  add(
    "integrity_checked",
    true,
    unchecked.length === 0,
    unchecked.length === 0
      ? `every non-synthetic source has been through the integrity check (${heldBack.length} held back: quarantined or replaced)`
      : `${unchecked.length} non-synthetic source(s) never checked (not served; a live run would not measure the corpus as it will be served) — npm run corpus:integrity -- prepare --apply`
  );
  if (!input.db.repairs.ok) {
    add("known_defects", true, false, `the known-defect manifest could not be read: ${input.db.repairs.error}`);
  } else {
    const { plan, blockers } = input.db.repairs;
    add(
      "known_defects",
      true,
      blockers.length === 0,
      blockers.length === 0
        ? "no launch-blocking defect of the manifest can be served"
        : `launch-blocking defect(s) still servable: ${blockers.map((b) => `${b.id} — ${b.detail}`).join("; ")} — npm run corpus:integrity -- prepare --apply`
    );
    const pending = plan.filter((p) => p.outcome === "apply");
    add(
      "repairs_applied",
      true,
      pending.length === 0,
      pending.length === 0
        ? "every applicable manifest repair is applied"
        : `${pending.length} manifest repair(s) not applied (${[...new Set(pending.map((p) => p.id))].join(", ")}) — npm run corpus:integrity -- prepare --apply`
    );
    const review = plan.filter((p) => p.outcome === "conflict" || p.outcome === "mismatch" || p.outcome === "too_many" || p.outcome === "review");
    add(
      "repairs_review",
      false,
      review.length === 0,
      review.length === 0 ? "no manifest entry needs a reviewer" : `for a reviewer: ${review.map((p) => `${p.id} (${p.outcome}${p.sourceId !== null ? `, source ${p.sourceId}` : ""})`).join("; ")}`
    );
  }
  add(
    "no_test_vectors",
    true,
    testVectorChunks === 0,
    testVectorChunks === 0 ? "no test-model vectors" : `${testVectorChunks} chunk(s) of non-synthetic sources carry a test-model vector: test data, not the production corpus`
  );

  const servableChunks = real.reduce((n, s) => n + s.chunksActual, 0);
  // Untagged vectors (stored before Phase 2 recorded the model) are the legacy
  // model — exactly how retrieval treats them (search/hybrid.ts).
  const visibleChunks = real.reduce((n, s) => {
    const models = s.models.length > 0 ? s.models : s.embedded > 0 ? [legacy] : [];
    return models.length > 0 && models.every((m) => m === served) ? n + s.embedded : n;
  }, 0);
  const ratio = servableChunks === 0 ? 0 : visibleChunks / servableChunks;
  add(
    "embedding_model",
    true,
    servableChunks > 0 && ratio >= MIN_VISIBLE_CHUNK_RATIO,
    `${visibleChunks} of ${servableChunks} servable chunks (${Math.round(ratio * 1000) / 10}%) carry a ${served} vector; required ≥ ${MIN_VISIBLE_CHUNK_RATIO * 100}%`
  );

  const p0 = inventory.coverage.filter((c) => c.law.priority === "P0");
  const p0Servable = p0.filter((c) => c.servable);
  const p0Missing = p0.filter((c) => !c.servable).map((c) => `${c.law.name}${c.law.number ? ` ${c.law.number}/${c.law.year}` : ""}`);
  add("p0_any", true, p0.length === 0 || p0Servable.length > 0, `${p0Servable.length} of ${p0.length} P0 laws servable`);
  add("p0_all", false, p0Missing.length === 0, p0Missing.length ? `not servable: ${p0Missing.join("; ")}` : "every P0 law is servable");
  const gazetteVerified = real.filter((s) => s.gazetteVerified).length;
  const authoritative = real.filter((s) => s.authoritative).length;
  add(
    "authoritative",
    false,
    authoritative > 0,
    authoritative > 0
      ? `${authoritative} Gazette-verified source(s) with a passed integrity check`
      : "no Gazette-verified source: every grounded answer will say its texts were not compared with the Official Gazette (an official provenance is not a Gazette verification)"
  );
  add("anomalies", false, inventory.summary.critical === 0, `${inventory.summary.critical} critical / ${inventory.summary.warnings} warning inventory anomalies (npm run corpus:inventory)`);

  return {
    ok: checks.every((c) => !c.blocking || c.ok),
    checks,
    corpus: {
      servableSources: real.length,
      servableChunks,
      visibleChunks,
      uncheckedSources: unchecked.length,
      heldBackSources: heldBack.length,
      gazetteVerifiedSources: gazetteVerified,
      authoritativeSources: authoritative,
      p0Laws: p0.length,
      p0Servable: p0Servable.length,
      p0Missing,
      criticalAnomalies: inventory.summary.critical,
    },
    servedEmbeddingModel: served,
  };
}

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Reads what evaluatePreflight needs from the database. Never throws: an unreachable database is a result. */
export async function loadPreflightDb(
  db: Q,
  env: Readonly<Record<string, string | undefined>>,
  registryPath: string,
  repairsPath: string = DEFAULT_REPAIRS_PATH
): Promise<PreflightDb> {
  try {
    const present = new Set(
      (await db.query(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`)).rows.flatMap((r) => [
        String(r.t),
        `${r.t}.${r.c}`,
      ])
    );
    const schemaMissing = REQUIRED_SCHEMA.filter((x) => !present.has(x));
    const width = await db.query(
      `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute
        WHERE attrelid = to_regclass('public.legal_documents') AND attname = 'embedding' AND NOT attisdropped`
    );
    const vectorDim = Number(/\((\d+)\)/.exec(String(width.rows[0]?.t ?? ""))?.[1] ?? NaN);
    const registry = loadRegistry(registryPath);
    if (schemaMissing.some((x) => x.startsWith("legal_sources.") || x.startsWith("legal_documents."))) {
      // The inventory itself needs these columns: report the schema, measure nothing.
      return {
        ok: true,
        schemaMissing,
        vectorDim: Number.isFinite(vectorDim) ? vectorDim : null,
        inventory: analyzeInventory({ sources: [], chunks: [], orphanChunks: 0, registry, servedModel: null }),
        testVectorChunks: 0,
        repairs: { ok: false, error: "schema not migrated" },
      };
    }
    const input = await loadInventoryInput(db);
    const inventory = analyzeInventory({ ...input, registry, servedModel: env.EMBEDDING_MODEL ?? "text-embedding-3-small", includeSynthetic: false });
    const tv = await db.query(
      `SELECT count(*)::int AS n FROM legal_documents d JOIN legal_sources s ON s.id = d.source_id
        WHERE s.is_synthetic = false AND d.embedding_model LIKE 'test-%'`
    );
    return {
      ok: true,
      schemaMissing,
      vectorDim: Number.isFinite(vectorDim) ? vectorDim : null,
      inventory,
      testVectorChunks: Number(tv.rows[0]?.n ?? 0),
      repairs: await loadPreflightRepairs(db, repairsPath),
    };
  } catch (err) {
    return { ok: false, error: redact(err instanceof Error ? err.message.split("\n")[0] : "unknown error") };
  }
}

/** The known-defect manifest planned against this database. A manifest that cannot be read is a result, not a crash. */
export async function loadPreflightRepairs(db: Q, repairsPath: string): Promise<PreflightRepairs> {
  let manifest;
  try {
    manifest = loadRepairManifest(repairsPath);
  } catch (err) {
    return { ok: false, error: redact(err instanceof Error ? err.message.split("\n")[0] : String(err)) };
  }
  const { rows, applied } = await loadRepairRows(db);
  return { ok: true, plan: planRepairs(manifest, rows, applied), blockers: servingBlockers(manifest, rows, applied, false) };
}

/** Removes anything shaped like a credential from a message before it is printed. */
export function redact(s: string): string {
  return s
    .replace(/\b(sk|pa|key|co)-[A-Za-z0-9_-]{8,}/g, "$1-…")
    .replace(/\/\/[^/\s:@]+:[^@\s]+@/g, "//…@")
    .slice(0, 240);
}

/** The preflight against the configured database (process env unless given). */
export async function runLivePreflight(opts: {
  registryPath: string;
  repairsPath?: string;
  needChat?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<PreflightResult> {
  const env = opts.env ?? process.env;
  let db: PreflightDb;
  try {
    const { getPool } = await import("../db");
    db = await loadPreflightDb(getPool(), env, opts.registryPath, opts.repairsPath);
  } catch (err) {
    db = { ok: false, error: redact(err instanceof Error ? err.message.split("\n")[0] : "unknown error") };
  }
  return evaluatePreflight({ env, db, needChat: opts.needChat });
}

/**
 * Optional (--probe): one short embedding and one tiny chat call through the
 * configured providers, to prove they answer from this machine and that the
 * vector width matches the column. A fraction of a cent. Never run by default.
 */
export async function probeProviders(opts: { vectorDim: number | null; needChat: boolean }): Promise<PreflightCheck[]> {
  const { getChatProvider, getEmbeddingProvider } = await import("../ai");
  const out: PreflightCheck[] = [];
  const started = Date.now();
  try {
    const r = await getEmbeddingProvider().embed(["اختبار الاتصال"], "query");
    const width = r.embeddings[0]?.length ?? 0;
    const ok = opts.vectorDim === null || width === opts.vectorDim;
    out.push({ id: "probe_embedding", blocking: true, ok, detail: `answered in ${Date.now() - started} ms, width ${width}${ok ? "" : ` ≠ column ${opts.vectorDim}`}` });
  } catch (err) {
    out.push({ id: "probe_embedding", blocking: true, ok: false, detail: redact(err instanceof Error ? err.message.split("\n")[0] : String(err)) });
  }
  if (opts.needChat) {
    const t = Date.now();
    try {
      const r = await getChatProvider().chat([{ role: "user", content: "Reply with the single word: ok" }], { maxTokens: 5, purpose: "preflight", timeoutMs: 20_000 });
      out.push({ id: "probe_chat", blocking: true, ok: true, detail: `${r.model ?? "model"} answered in ${Date.now() - t} ms` });
    } catch (err) {
      out.push({ id: "probe_chat", blocking: true, ok: false, detail: redact(err instanceof Error ? err.message.split("\n")[0] : String(err)) });
    }
  }
  return out;
}

/** One line per check, for the terminal. */
export function preflightText(r: Pick<PreflightResult, "ok" | "checks">): string {
  const lines = r.checks.map((c) => `${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.id.padEnd(20)} ${c.detail}${!c.ok && c.blocking ? "  [BLOCKING]" : ""}`);
  lines.push(r.ok ? "Preflight: PASS — a live run would measure real models over the real corpus." : "Preflight: BLOCKED — not a live environment; nothing was run.");
  return lines.join("\n");
}
