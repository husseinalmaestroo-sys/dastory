/**
 * Post-ingest verification for the newly added laws.
 *
 * Two things worth proving rather than assuming:
 *   1. effective_date as the DB actually stores it — cast to text, not through
 *      a JS Date, whose toISOString() shifts a DATE by the local offset and
 *      reports 2001-08-15 for a row holding 2001-08-16.
 *   2. That the chunks are retrievable by article number and by content, which
 *      is the whole point of the ingest and the thing that silently fails when
 *      article headers were mangled.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

const NEW_IDS = [159, 160, 161, 163, 164, 165, 166, 167, 168, 169];

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));

  console.log("── stored effective_date (as text) ───────────────────────────");
  const { rows: dates } = await pool.query(
    `SELECT id, law_number, effective_date::text AS eff, is_current_version, title
       FROM legal_sources WHERE id = ANY($1) ORDER BY id`,
    [NEW_IDS]
  );
  for (const r of dates) {
    console.log(
      `  ${r.id}  رقم ${String(r.law_number).padEnd(4)} eff=${r.eff}  current=${r.is_current_version}  ${r.title}`
    );
  }

  console.log("\n── article coverage per source ───────────────────────────────");
  const { rows: cov } = await pool.query(
    `SELECT s.id, s.title,
            count(*) AS chunks,
            count(d.article_number) AS numbered,
            count(DISTINCT d.article_number) AS distinct_articles
       FROM legal_sources s JOIN legal_documents d ON d.source_id = s.id
      WHERE s.id = ANY($1)
      GROUP BY s.id, s.title ORDER BY s.id`,
    [NEW_IDS]
  );
  for (const r of cov) {
    console.log(
      `  ${r.id}  chunks=${String(r.chunks).padStart(4)}  numbered=${String(r.numbered).padStart(4)}  ` +
        `distinct=${String(r.distinct_articles).padStart(4)}  ${r.title}`
    );
  }

  console.log("\n── retrieval spot-checks (exact article by number) ───────────");
  const spots: [number, string, string][] = [
    [165, "13", "الملكية العقارية"],
    [163, "31", "التحكيم"],
    [167, "20", "ضريبة الدخل"],
    [168, "8", "حماية المستهلك"],
    [166, "30", "البينات"],
    [164, "5", "المالكين والمستأجرين"],
    [169, "58", "الأحوال الشخصية"],
  ];
  for (const [sourceId, art, label] of spots) {
    const { rows } = await pool.query(
      `SELECT chunk_text FROM legal_documents
        WHERE source_id = $1 AND article_number = $2 LIMIT 1`,
      [sourceId, art]
    );
    const snippet = rows[0]?.chunk_text?.replace(/\s+/g, " ").slice(0, 78) ?? "(NOT FOUND)";
    console.log(`  ${label} م.${art}: ${snippet}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
