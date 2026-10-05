/**
 * Which database this is (Phase 2.4) — read-only, credentials never printed.
 *
 *   npm run db:identity [-- --json out.json]
 *
 * Prints the target (host, port, database, Neon endpoint, environment and
 * why — src/lib/db-target.ts), the server, the schema version this database
 * was migrated to against this checkout's db/schema.sql, the columns the
 * current pipeline needs that are missing, and the corpus at a glance. Works
 * on any schema version, including one never migrated by this repository.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPool, dbTransport } from "../src/lib/db-pool";
import { describeTarget, targetLine } from "../src/lib/db-target";

const REQUIRED = [
  "legal_sources.integrity_status",
  "legal_sources.gazette_status",
  "legal_sources.is_synthetic",
  "legal_sources.provenance",
  "legal_sources.jurisdiction",
  "legal_documents.embedding_model",
  "corpus_integrity_events.kind",
  "schema_versions",
];

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  const target = describeTarget(url);
  const checkout = createHash("sha256").update(readFileSync(resolve("db/schema.sql"), "utf8")).digest("hex");
  const pool = createPool(url, { max: 1, connectionTimeoutMillis: 15_000 });
  const out: Record<string, unknown> = { target, transport: dbTransport(), checkoutSchema: checkout };
  try {
    const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
    const [srv] = await q(
      `SELECT current_database() AS db, version() AS version, current_setting('server_version_num') AS num,
              current_setting('neon.timeline_id', true) AS timeline, current_setting('neon.tenant_id', true) AS tenant`
    );
    out.server = { database: srv.db, version: String(srv.version).split(",")[0], neonTimeline: srv.timeline ?? null, neonTenant: srv.tenant ?? null };
    const cols = new Set(
      (await q(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`)).flatMap((r) => [
        String(r.t),
        `${r.t}.${r.c}`,
      ])
    );
    const missing = REQUIRED.filter((x) => !cols.has(x));
    const applied = cols.has("schema_versions") ? await q(`SELECT fingerprint, applied_at, vector_dim FROM schema_versions ORDER BY applied_at DESC LIMIT 1`) : [];
    out.schema = {
      appliedFingerprint: applied[0]?.fingerprint ?? null,
      appliedAt: applied[0]?.applied_at ?? null,
      matchesCheckout: applied[0]?.fingerprint === checkout,
      missingForCurrentPipeline: missing,
    };
    if (cols.has("legal_sources")) {
      const has = (c: string) => cols.has(`legal_sources.${c}`);
      const [c] = await q(
        `SELECT count(*)::int AS sources,
                ${has("is_synthetic") ? "count(*) FILTER (WHERE is_synthetic)::int" : "NULL::int"} AS synthetic,
                count(*) FILTER (WHERE status = 'ready')::int AS ready
           FROM legal_sources`
      );
      const integrity = has("integrity_status")
        ? Object.fromEntries((await q(`SELECT integrity_status AS s, count(*)::int AS n FROM legal_sources GROUP BY 1 ORDER BY 1`)).map((r) => [r.s, r.n]))
        : "column absent (schema predates Phase 2.1)";
      const [d] = cols.has("legal_documents")
        ? await q(`SELECT count(*)::int AS chunks, count(embedding)::int AS embedded FROM legal_documents`)
        : [{ chunks: 0, embedded: 0 }];
      const models = cols.has("legal_documents.embedding_model")
        ? Object.fromEntries((await q(`SELECT COALESCE(embedding_model, '(untagged)') AS m, count(*)::int AS n FROM legal_documents WHERE embedding IS NOT NULL GROUP BY 1`)).map((r) => [r.m, r.n]))
        : "column absent";
      out.corpus = { ...c, integrity, chunks: d.chunks, embedded: d.embedded, embeddingModels: models };
    }
  } catch (err) {
    out.error = (err instanceof Error ? err.message : String(err)).split("\n")[0].replace(/\/\/[^@\s]+@/g, "//…@").slice(0, 300);
  } finally {
    await pool.end().catch(() => undefined);
  }

  console.log(`Target:    ${targetLine(target)}`);
  console.log(`Transport: ${out.transport}`);
  if (out.error) console.log(`ERROR:     ${out.error}`);
  if (out.server) console.log(`Server:    ${JSON.stringify(out.server)}`);
  if (out.schema) console.log(`Schema:    ${JSON.stringify(out.schema)} (this checkout: ${checkout.slice(0, 16)}…)`);
  if (out.corpus) console.log(`Corpus:    ${JSON.stringify(out.corpus)}`);
  const json = arg("json");
  if (json) writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), ...out }, null, 1));
  process.exit(out.error ? 1 : 0);
}

main();
