/**
 * Re-ingests existing sources by id — re-chunks and re-embeds them through the
 * current pipeline, so chunks written before a chunker change pick up the new
 * columns (part/chapter/section/legal_topics/...). Costs embedding-API calls.
 *
 *   npx tsx scripts/reindex.ts 159 160 161
 */
import "dotenv/config";
import { reindexSource } from "../src/lib/ingest/pipeline";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n));
  if (ids.length === 0) throw new Error("Usage: reindex.ts <id> [id ...]");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set — reindex embeds.");

  for (const id of ids) {
    process.stdout.write(`reindexing source ${id} ... `);
    try {
      const r = await reindexSource(id);
      console.log(`ok  ${r.chunks} chunks  ${r.method}  (${r.embeddingTokens} embed tokens)`);
    } catch (err) {
      console.log(`FAIL  ${(err as Error).message}`);
    }
  }
  process.exit(0);
}
main().catch((err) => {
  console.error("reindex failed:", err.message);
  process.exit(1);
});
