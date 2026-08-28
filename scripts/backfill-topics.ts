/**
 * Recomputes legal_topics for every legal_documents row from its own
 * chunk_text, using the CURRENT legal-topics.ts TOPICS table. Pure text
 * transform — no embedding calls, no OpenAI cost. Run this after any edit to
 * TOPICS (new label, retired trigger, retuned trigger list) instead of the
 * much more expensive scripts/reindex.ts, which re-embeds everything just to
 * pick up a metadata change that has nothing to do with the vector.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/backfill-topics.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { extractLegalTopics } from "../src/lib/ingest/legal-topics";

const BATCH = 500;

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));

  const { rows: countRows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM legal_documents`);
  const total = Number(countRows[0].n);
  console.log(`Recomputing legal_topics for ${total} chunks ...`);

  let done = 0;
  let changed = 0;
  for (let offset = 0; offset < total; offset += BATCH) {
    const { rows } = await pool.query<{ id: number; chunk_text: string; legal_topics: string[] | null }>(
      `SELECT id, chunk_text, legal_topics FROM legal_documents ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH, offset]
    );
    if (rows.length === 0) break;

    // legal_topics arrays are variable-length (0-4 items), so a rectangular
    // unnest($1::text[][]) is not an option — Postgres arrays must be
    // rectangular. jsonb_to_recordset has no such constraint.
    const updates: { id: number; legal_topics: string[] }[] = [];
    for (const r of rows) {
      const next = extractLegalTopics(r.chunk_text);
      const prev = r.legal_topics ?? [];
      if (next.join("|") !== prev.join("|")) changed++;
      updates.push({ id: r.id, legal_topics: next });
    }

    await pool.query(
      `UPDATE legal_documents AS d
          SET legal_topics = u.legal_topics
         FROM jsonb_to_recordset($1::jsonb) AS u(id bigint, legal_topics text[])
        WHERE d.id = u.id`,
      [JSON.stringify(updates)]
    );

    done += rows.length;
    process.stdout.write(`\r  ${done}/${total}`);
  }

  console.log(`\nDone. ${changed} row(s) changed.`);
  await pool.end();
}

main().catch((err) => {
  console.error("backfill failed:", err.message);
  process.exit(1);
});
