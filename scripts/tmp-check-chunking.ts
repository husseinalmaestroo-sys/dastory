/**
 * Runs the real ingest text path — cleanText then chunkLegalText — over a
 * staged .txt and reports how many chunks come out carrying an article number.
 *
 * This is the check that matters before spending embedding money. chunk.ts
 * anchors ARTICLE_RE to the start of a line, so an extractor that emits
 * ": (1المادة )" or "-المادة1" produces a document that looks perfect by every
 * text-quality measure and still chunks as anonymous prose — 224 articles that
 * can never be cited, and nothing anywhere reports an error.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-check-chunking.ts <file.txt...>
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { cleanText } from "../src/lib/ingest/clean";
import { chunkLegalText } from "../src/lib/ingest/chunk";

async function main() {
  for (const f of process.argv.slice(2)) {
    const raw = await readFile(f, "utf8");
    const chunks = chunkLegalText(cleanText(raw), { sourceType: "law" });
    const numbered = chunks.filter((c) => c.articleNumber !== null);
    const nums = new Set(numbered.map((c) => c.articleNumber));
    const withPart = chunks.filter((c) => c.part || c.chapter).length;

    const pct = chunks.length ? ((numbered.length / chunks.length) * 100).toFixed(0) : "0";
    console.log(
      `${basename(f).padEnd(46)} chunks=${String(chunks.length).padStart(4)}  ` +
        `numbered=${String(numbered.length).padStart(4)} (${pct.padStart(3)}%)  ` +
        `distinct articles=${String(nums.size).padStart(4)}  with part/chapter=${withPart}`
    );

    // Which numbers are absent from 1..max. A gap is an article that exists in
    // the statute and cannot be retrieved by its number.
    const ints = [...nums].map((n) => Number(String(n).match(/\d+/)?.[0])).filter(Number.isFinite);
    if (ints.length) {
      const max = Math.max(...ints);
      const have = new Set(ints);
      const missing = Array.from({ length: max }, (_, i) => i + 1).filter((i) => !have.has(i));
      if (missing.length) {
        console.log(
          `    missing 1..${max}: ${missing.slice(0, 30).join(",")}${missing.length > 30 ? ` … (${missing.length})` : ""}`
        );
      }
    }
  }
}

main();
