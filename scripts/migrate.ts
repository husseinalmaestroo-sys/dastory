/**
 * Applies db/schema.sql. Idempotent — run it on every deploy.
 *
 *   npm run db:migrate
 */
// Next loads .env on its own; a plain tsx script does not.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const dim = Number(process.env.EMBEDDING_DIM ?? 1536);

async function main() {
  const pool = new Pool(poolConfig(DATABASE_URL!));
  let sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");

  // The schema is written for 1536 dims (text-embedding-3-small). Swapping the
  // embedding model means a different width, and pgvector fixes width at DDL
  // time — so patch it here rather than keeping two copies of the schema.
  if (dim !== 1536) {
    sql = sql.replace(/vector\(1536\)/g, `vector(${dim})`);
    console.log(`Embedding dimension overridden to ${dim}.`);
  }

  console.log("Applying db/schema.sql ...");
  await pool.query(sql);

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
