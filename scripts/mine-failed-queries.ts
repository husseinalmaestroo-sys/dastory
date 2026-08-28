/**
 * Mines `search_log` for the questions that retrieved the least — the queries
 * the knowledge base is failing to answer.
 *
 * This is the FIRST source for growing `src/lib/search/legal-ontology.ts`. A
 * query that repeatedly returns few or no chunks is usually not a gap in the
 * corpus but a gap in vocabulary: the lawyer wrote everyday Arabic and the
 * statute uses different words. Each such phrasing is a missing ontology
 * trigger, so this prints them ranked by how often they fail.
 *
 *   npm run mine-failed-queries                                    # top 30 failing
 *   npm run mine-failed-queries -- --limit=50 --max-hits=2
 *
 * legal-ontology.ts imports "server-only", so plain `npx tsx` on this file
 * throws immediately (that package throws unconditionally outside Next's
 * bundler) — must run through scripts/tsconfig.verify.json, which aliases
 * server-only to a no-op stub. The npm script above already does this; if
 * invoking tsx directly, add: --tsconfig scripts/tsconfig.verify.json
 *
 * Options:
 *   --limit=<n>      How many to print. Default 30.
 *   --max-hits=<n>   Treat a query as failing at or below this hit count.
 *                    Default 0 (returned nothing at all).
 *   --since=<days>   Only consider the last N days. Default: all time.
 *
 * Queries already covered by the ontology are marked [covered] — those failed
 * for some other reason (the law genuinely isn't in the corpus), so they belong
 * on the ingest list, not in the ontology.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { expandWithOntology } from "../src/lib/search/legal-ontology";

type Row = { query: string; times: number; avg_hits: number; last_seen: string };

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
  const limit = Number(get("limit") ?? 30);
  const maxHits = Number(get("max-hits") ?? 0);
  const since = get("since") ? Number(get("since")) : null;

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool(poolConfig(process.env.DATABASE_URL));

  // Group by the normalised query text so the same question asked ten ways
  // does not scatter across ten rows.
  const { rows } = await pool.query<Row>(
    `SELECT lower(btrim(query))          AS query,
            COUNT(*)::int                AS times,
            AVG(hit_count)::numeric(6,2) AS avg_hits,
            MAX(created_at)::date::text  AS last_seen
       FROM search_log
      WHERE query IS NOT NULL AND btrim(query) <> ''
        AND query NOT LIKE '[%'   -- excludes drafting output, e.g. "[مسودة: ...]" (see /api/draft) —
                                   -- not a search query, and its free text would drown out real ones
        ${since ? "AND created_at >= now() - ($2 || ' days')::interval" : ""}
      GROUP BY 1
     HAVING AVG(hit_count) <= $1
      ORDER BY times DESC, avg_hits ASC
      LIMIT ${Number.isFinite(limit) ? limit : 30}`,
    since ? [maxHits, String(since)] : [maxHits]
  );

  const { rows: totals } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM search_log`);
  await pool.end();

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  search_log rows: ${totals[0].n}`);
  console.log(`  failing queries (avg hits <= ${maxHits}${since ? `, last ${since}d` : ""}): ${rows.length}`);
  console.log(`${"=".repeat(70)}\n`);

  if (rows.length === 0) {
    console.log("Nothing to mine yet — no logged query fell at or below the hit threshold.");
    console.log("Once the app has real traffic, re-run this to find the phrasings the");
    console.log("ontology is missing.\n");
    return;
  }

  let uncovered = 0;
  for (const r of rows) {
    const { terms, matches } = expandWithOntology(r.query);
    const covered = terms.length > 0;
    if (!covered) uncovered++;
    const tag = covered ? `[covered: ${matches.map((m) => m.concept).join(", ")}]` : "[NOT COVERED]";
    console.log(`  ${String(r.times).padStart(3)}×  avg ${String(r.avg_hits).padStart(5)}  ${r.last_seen}  ${tag}`);
    console.log(`        ${r.query.slice(0, 90)}`);
  }

  console.log(`\n  ${uncovered} of ${rows.length} are NOT covered by the ontology.`);
  console.log(`  Add their lay phrasings as triggers in src/lib/search/legal-ontology.ts,`);
  console.log(`  mapped to the statutory terms the relevant law actually uses.`);
  console.log(`  The ones marked [covered] failed for a different reason — most likely`);
  console.log(`  the law itself is not in the corpus. Those belong on the ingest list.\n`);
}

main().catch((err) => {
  console.error("\nmine-failed-queries failed:", err.message);
  process.exit(1);
});
