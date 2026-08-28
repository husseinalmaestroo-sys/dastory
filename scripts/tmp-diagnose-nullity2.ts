/**
 * Follow-up to tmp-diagnose-nullity.ts: checks where the "relative nullity"
 * side articles actually land against the REAL question's own embedding (not
 * a hand-picked probe string), and what legal_topics they carry — to tell
 * apart "just below the gate" from "genuinely far away", and whether the
 * existing AREA_TOPICS boost could even reach them.
 */
import "dotenv/config";
import { query, toVector } from "../src/lib/db";
import { getEmbeddingProvider } from "../src/lib/ai";
import { normalizeQuery } from "../src/lib/search/normalize";

const QUESTION =
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟";

const CANDIDATE_IDS = [7418, 7419, 7417, 7426, 481, 482, 7498, 7420, 474, 493];

async function main() {
  const provider = getEmbeddingProvider();
  const q = normalizeQuery(QUESTION);
  const emb = await provider.embed([q], "query");
  const vec = toVector(emb.embeddings[0]);

  const rows = await query<{
    id: number;
    article_number: string | null;
    legal_topics: string[] | null;
    score: number;
    chunk_text: string;
  }>(
    `SELECT id, article_number, legal_topics, (1 - (embedding <=> $1::vector))::real AS score, chunk_text
       FROM legal_documents WHERE id = ANY($2::bigint[])`,
    [vec, CANDIDATE_IDS]
  );
  rows.sort((a, b) => b.score - a.score);
  console.log("Similarity of specific civil-code articles against the REAL question's own embedding:\n");
  for (const r of rows) {
    console.log(
      `  #${r.id} م.${r.article_number ?? "?"}  score=${r.score.toFixed(4)}  topics=${JSON.stringify(r.legal_topics)}`
    );
    console.log(`      ${r.chunk_text.replace(/\s+/g, " ").slice(0, 100)}...`);
  }

  // Where do these ids rank in the raw, ungated, unfiltered vector arm overall
  // (i.e. is 176 at rank 9, or rank 900)?
  const { rows: top } = await (await import("../src/lib/db")).getPool().query(
    `SELECT id, (1 - (embedding <=> $1::vector))::real AS score
       FROM legal_documents WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 40`,
    [vec]
  );
  console.log("\nRaw top-40 vector-arm ids for the real question (no filters, no gate):");
  top.forEach((r: any, i: number) => {
    const flag = CANDIDATE_IDS.includes(r.id) ? "  <== relative-nullity candidate" : "";
    console.log(`  rank ${i + 1}: #${r.id} score=${r.score.toFixed(4)}${flag}`);
  });
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
