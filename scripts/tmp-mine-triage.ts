/**
 * One-off triage for the 8 queries surfaced by mine-failed-queries.ts
 * (2026-07-25 run). For each ambiguous case, checks whether the relevant
 * statutory concept actually exists in the corpus (chunk count + sample law
 * names) so failures can be sorted into: ontology gap / corpus-ingest gap /
 * noise. Not part of the permanent toolchain.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function check(pool: Pool, label: string, term: string) {
  const { rows } = await pool.query(
    `SELECT d.law_name, COUNT(*)::int AS n
       FROM legal_documents d
      WHERE d.chunk_text ILIKE $1
      GROUP BY d.law_name
      ORDER BY n DESC
      LIMIT 5`,
    [`%${term}%`]
  );
  console.log(`\n-- ${label} (chunk_text ILIKE "%${term}%") --`);
  if (rows.length === 0) console.log("   NO MATCHES in corpus");
  for (const r of rows) console.log(`   ${String(r.n).padStart(4)}x  ${r.law_name}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool(poolConfig(process.env.DATABASE_URL));

  await check(pool, "fraud noun", "الاحتيال");
  await check(pool, "fraud elements-ish", "أركان");
  await check(pool, "misuse of credit", "إساءة الائتمان");
  await check(pool, "breach of trust", "خيانة الأمانة");
  await check(pool, "constitutional court", "المحكمة الدستورية");
  await check(pool, "muqawala contract", "عقد المقاولة");
  await check(pool, "muqawala alt spelling", "المقاولة");
  await check(pool, "court fees", "الرسوم القضائية");
  await check(pool, "hidden defect warranty", "العيب الخفي");
  await check(pool, "consumer protection defect", "عيب السلعة");

  const { rows: sources } = await pool.query(
    `SELECT DISTINCT court FROM legal_documents WHERE court IS NOT NULL ORDER BY 1 LIMIT 20`
  );
  console.log(`\n-- distinct 'court' values in corpus --`);
  for (const r of sources) console.log(`   ${r.court}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
