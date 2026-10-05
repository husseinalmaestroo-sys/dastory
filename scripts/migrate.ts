/**
 * Applies db/schema.sql. Idempotent — run it on every deploy.
 *
 *   npm run db:migrate [-- --confirm-production]
 *
 * Phase 2.4: prints the target (host, database, environment — never the
 * credentials) and refuses an undeclared remote database or production
 * without --confirm-production (src/lib/db-target.ts). Records the schema's
 * sha256 in schema_versions.
 */
// Next loads .env on its own; a plain tsx script does not.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPool } from "../src/lib/db-pool";
import { assertMayMutate, describeTarget, targetLine } from "../src/lib/db-target";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const dim = Number(process.env.EMBEDDING_DIM ?? 1536);

async function main() {
  const target = describeTarget(DATABASE_URL!);
  console.log(`Target: ${targetLine(target)}`);
  assertMayMutate(target, { confirmProduction: process.argv.includes("--confirm-production"), what: "db:migrate" });
  const pool = createPool(DATABASE_URL!);
  const raw = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  let sql = raw;

  // The schema is written for 1536 dims (text-embedding-3-small). Swapping the
  // embedding model means a different width, and pgvector fixes width at DDL
  // time — so patch it here rather than keeping two copies of the schema.
  if (dim !== 1536) {
    sql = sql.replace(/vector\(1536\)/g, `vector(${dim})`);
    console.log(`Embedding dimension overridden to ${dim}.`);
  }

  console.log("Applying db/schema.sql ...");
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_versions (fingerprint, vector_dim) VALUES ($1, $2)
     ON CONFLICT (fingerprint) DO UPDATE SET applied_at = now(), vector_dim = EXCLUDED.vector_dim`,
    [fingerprint, dim]
  );
  console.log(`Schema version: ${fingerprint.slice(0, 16)}…`);

  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log("Tables now present:");
  for (const r of rows) console.log("  -", r.table_name);

  await pool.end();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
