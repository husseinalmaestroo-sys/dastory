import "dotenv/config";
import { reindexSource } from "../src/lib/ingest/pipeline";

const IDS = [172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184];

async function main() {
  let ok = 0;
  let failed = 0;
  for (const id of IDS) {
    process.stdout.write(`[${id}] `);
    try {
      const r = await reindexSource(id);
      ok++;
      console.log(`ok — ${r.chunks} chunks, ${r.pages} pages, method=${r.method}`);
    } catch (err) {
      failed++;
      console.log(`FAILED — ${(err as Error).message}`);
    }
  }
  console.log(`\n${ok} reindexed, ${failed} failed, of ${IDS.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
