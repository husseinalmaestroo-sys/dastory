import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));
  const { rows } = await pool.query(
    `SELECT id, title, source_type, category, status, chunk_count FROM legal_sources WHERE category = 'عمالية' OR title ILIKE '%عمل%' OR title ILIKE '%تقادم%' ORDER BY id`
  );
  console.log(JSON.stringify(rows, null, 2));
  const { rows: total } = await pool.query(`SELECT count(*) FROM legal_sources`);
  console.log("total sources:", total[0].count);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
