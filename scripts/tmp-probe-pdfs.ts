/**
 * Probes the text layer of each PDF given on argv and reports whether the
 * project's own mojibake gate (quality.ts) would accept it. Deliberately does
 * NOT call OCR: the point is to find out, cheaply, which files are going to
 * need the ~6s/page path before committing to a batch.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-probe-pdfs.ts <file...>
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { assessArabicText } from "../src/lib/ingest/quality";

const MIN_CHARS_PER_PAGE = 80; // mirrors extract.ts

async function parseTextLayer(buffer: Buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
  try {
    const data = await pdfParse(buffer);
    return { text: data.text ?? "", pages: data.numpages ?? 1 };
  } catch (err) {
    return { text: "", pages: 1, error: (err as Error).message };
  }
}

async function main() {
  const files = process.argv.slice(2);
  for (const f of files) {
    const name = basename(f);
    try {
      const buf = await readFile(f);
      const { text, pages } = await parseTextLayer(buf);
      const density = text.trim().length / Math.max(pages, 1);
      const q = assessArabicText(text);
      const arts = new Set(
        [...text.matchAll(/^\s*(?:المادة|ال?ماده)\s*\(?\s*(\d+)/gm)].map((m) => Number(m[1]))
      );

      const verdict =
        density < MIN_CHARS_PER_PAGE ? "SCAN → OCR" : q.garbled ? "GARBLED → OCR" : "text-layer OK";

      console.log(`\n${"─".repeat(72)}\n${name}`);
      console.log(
        `  ${verdict.padEnd(16)} pages=${pages}  chars=${text.trim().length}  density=${density.toFixed(0)}`
      );
      console.log(
        `  arabicRatio=${q.arabicRatio.toFixed(2)}  distinctCommonWords=${q.distinctCommonWords}  articles=${arts.size}`
      );
      const sample = text.trim().replace(/\s+/g, " ").slice(0, 160);
      console.log(`  sample: ${sample}`);
    } catch (err) {
      console.log(`\n${"─".repeat(72)}\n${name}\n  ERROR: ${(err as Error).message}`);
    }
  }
}

main();
