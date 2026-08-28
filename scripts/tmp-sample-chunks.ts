import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));
  const ids = process.argv.slice(2).map(Number);
  for (const id of ids) {
    const { rows: src } = await pool.query(
      `SELECT id, title, law_number, year, effective_date, chunk_count FROM legal_sources WHERE id = $1`,
      [id]
    );
    console.log(`\n${"=".repeat(70)}\n#${id}  ${JSON.stringify(src[0])}`);
    const { rows } = await pool.query(
      `SELECT article_number, left(chunk_text, 400) AS sample
         FROM legal_documents WHERE source_id = $1
        ORDER BY id LIMIT 3`,
      [id]
    );
    for (const r of rows) {
      console.log(`--- article ${r.article_number} ---\n${r.sample}`);
    }
    const { rows: mid } = await pool.query(
      `SELECT article_number, left(chunk_text, 400) AS sample
         FROM legal_documents WHERE source_id = $1
        ORDER BY id OFFSET (SELECT count(*)/2 FROM legal_documents WHERE source_id = $1) LIMIT 2`,
      [id]
    );
    for (const r of mid) {
      console.log(`--- (mid) article ${r.article_number} ---\n${r.sample}`);
    }
  }
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
