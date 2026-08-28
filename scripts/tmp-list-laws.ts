/** Lists ingested legislation with its citation identity. */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));
  const { rows } = await pool.query(
    `SELECT id, title, source_type, law_number, year, effective_date, is_current_version,
            status, chunk_count
       FROM legal_sources
      WHERE source_type IN ('law','regulation','instruction')
      ORDER BY id`
  );
  for (const r of rows) {
    const eff = r.effective_date ? new Date(r.effective_date).toISOString().slice(0, 10) : "—";
    console.log(
      `${String(r.id).padStart(4)}  ${String(r.status).padEnd(8)} ${String(r.chunk_count ?? 0).padStart(5)}ch  ` +
        `رقم ${String(r.law_number ?? "—").padEnd(5)} ${String(r.year ?? "—").padEnd(6)} eff=${eff}  ${r.title}`
    );
  }
  const { rows: t } = await pool.query(
    `SELECT (SELECT count(*) FROM legal_sources WHERE status='ready') s,
            (SELECT count(*) FROM legal_documents) c`
  );
  console.log(`\nready sources: ${t[0].s}   indexed chunks: ${t[0].c}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
