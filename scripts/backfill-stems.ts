/**
 * Backfills stemmed_text for every legal_documents row ingested before the
 * arabic-stem.ts stemmed keyword arm existed. Pure text transform — no
 * embedding calls, no OpenAI cost. Safe to re-run: every row is recomputed
 * from its own chunk_text, so a later stemmer tweak just needs a re-run, not
 * a fresh migration.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/backfill-stems.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { stemArabicText } from "../src/lib/search/arabic-stem";

const BATCH = 500;

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM legal_documents`);
  const total = Number(countRows[0].n);
  console.log(`Backfilling stemmed_text for ${total} chunks ...`);

  let done = 0;
  for (let offset = 0; offset < total; offset += BATCH) {
    const { rows } = await pool.query<{ id: number; chunk_text: string }>(
      `SELECT id, chunk_text FROM legal_documents ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH, offset]
    );
    if (rows.length === 0) break;

    // One UPDATE per batch via unnest, not N round-trips.
    const ids = rows.map((r) => r.id);
    const stems = rows.map((r) => stemArabicText(r.chunk_text));
    await pool.query(
      `UPDATE legal_documents AS d
          SET stemmed_text = u.stemmed_text
         FROM unnest($1::bigint[], $2::text[]) AS u(id, stemmed_text)
        WHERE d.id = u.id`,
      [ids, stems]
    );

    done += rows.length;
    process.stdout.write(`\r  ${done}/${total}`);
  }

  console.log(`\nDone. Verifying ...`);
  const { rows: check } = await pool.query<{ empty: string; total: string }>(
    `SELECT count(*) FILTER (WHERE stemmed_text = '') AS empty, count(*) AS total FROM legal_documents`
  );
  console.log(`  ${check[0].total} total, ${check[0].empty} still empty.`);

  await pool.end();
}

main().catch((err) => {
  console.error("backfill failed:", err.message);
  process.exit(1);
});
