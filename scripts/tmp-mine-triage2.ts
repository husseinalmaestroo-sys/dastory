/**
 * Follow-up to tmp-mine-triage.ts: pulls full text of the 8 failing queries
 * and tests the tanwin-alef hypothesis directly against expandWithOntology.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { expandWithOntology } from "../src/lib/search/legal-ontology";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool(poolConfig(process.env.DATABASE_URL));

  const { rows } = await pool.query(
    `SELECT query, category, session_id, hit_count, created_at::date::text AS d
       FROM search_log
      WHERE lower(btrim(query)) IN (
        SELECT lower(btrim(query))
          FROM search_log
         GROUP BY 1
        HAVING AVG(hit_count) <= 2
      )
      ORDER BY created_at`
  );
  await pool.end();

  console.log(`\n${rows.length} raw rows behind the 8 grouped queries:\n`);
  for (const r of rows) {
    console.log(`[${r.d}] hits=${r.hit_count} cat=${r.category ?? "null"} session=${r.session_id ?? "null"}`);
    console.log(`   ${r.query}\n`);
  }

  console.log("\n--- tanwin-alef hypothesis test ---\n");
  const withAlef = "شخص متهم بجريمة إساءة ائتمان، لكنه يدعي أن المال كان قرضاً وليس أمانة";
  const withoutAlef = "شخص متهم بجريمة إساءة ائتمان، لكنه يدعي أن المال كان قرض وليس أمانة";
  console.log("WITH tanwin alef (قرضاً):", JSON.stringify(expandWithOntology(withAlef)));
  console.log("WITHOUT tanwin alef (قرض):", JSON.stringify(expandWithOntology(withoutAlef)));

  console.log("\n--- fraud query test ---");
  console.log(JSON.stringify(expandWithOntology("ما هي أركان جريمة الاحتيال؟"), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
