/**
 * Deep diagnostic for the 7 law PDFs. quality.ts answers one question — "is
 * this Arabic at all" — and all 7 pass it. These files fail in subtler ways
 * that the gate cannot see, and each needs a different repair:
 *
 *   1. Persian codepoints  ی (U+06CC) / ھ (U+06BE) / ک (U+06A9) standing in
 *      for ي / ه / ك. Renders identically, compares unequal — so the text
 *      indexes fine and then never matches a query typed on an Arabic keyboard.
 *   2. Reversed runs — bidi applied twice, so a span comes out letter-mirrored
 *      ("ارابتعا هب لمعيو" for "ويعمل به اعتبارا").
 *   3. ه → ى/و substitution from a bad OCR pass ("ىذا" for "هذا").
 *   4. Truncation — a "print this page" capture instead of the whole statute.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-diagnose-pdfs.ts <file...>
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

async function parseTextLayer(buffer: Buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
  const data = await pdfParse(buffer);
  return { text: data.text ?? "", pages: data.numpages ?? 1 };
}

const count = (t: string, re: RegExp) => (t.match(re) ?? []).length;

/** Common words spelled backwards. Real Arabic prose never contains these. */
const REVERSED = ["يف", "نم", "ىلع", "اذه", "يتلا", "نوناقلا", "ةداملا", "نأ", "وأ"];

/** Tell-tales of the ه→ى/و OCR substitution. */
const HEH_DAMAGE = ["ىذا", "ىذه", "بو ", "ىذين", "لو ", "عليو", "فيو", "منو", "بيا", "ىي", "ىو "];

async function main() {
  for (const f of process.argv.slice(2)) {
    const { text, pages } = await parseTextLayer(await readFile(f));

    // Bidi-tolerant: the number lands before or after "المادة" depending on how
    // the extractor resolved the run, and the parens may be split across it.
    const artNums = new Set<number>();
    for (const m of text.matchAll(/المادة\s*\)?\s*(\d{1,3})/g)) artNums.add(Number(m[1]));
    for (const m of text.matchAll(/\(?\s*(\d{1,3})\s*المادة/g)) artNums.add(Number(m[1]));

    const maxArt = artNums.size ? Math.max(...artNums) : 0;
    const gaps: number[] = [];
    for (let i = 1; i <= maxArt; i++) if (!artNums.has(i)) gaps.push(i);

    const persianYeh = count(text, /ی/g);
    const persianHeh = count(text, /ھ/g);
    const persianKaf = count(text, /ک/g);
    const arabicYeh = count(text, /ي/g);
    const arabicHeh = count(text, /ه/g);

    const revHits = REVERSED.map((w) => [w, count(text, new RegExp(`(?<![؀-ۿ])${w}(?![؀-ۿ])`, "g"))] as const)
      .filter(([, n]) => n > 0);
    const revTotal = revHits.reduce((s, [, n]) => s + n, 0);

    const hehHits = HEH_DAMAGE.map((w) => [w, count(text, new RegExp(w, "g"))] as const).filter(([, n]) => n > 0);
    const hehTotal = hehHits.reduce((s, [, n]) => s + n, 0);

    console.log(`\n${"═".repeat(74)}\n${basename(f)}`);
    console.log(`  pages=${pages}  chars=${text.trim().length}`);
    console.log(`  articles: found=${artNums.size}  max=${maxArt}  missing=${gaps.length}`);
    if (gaps.length) console.log(`    gaps: ${gaps.slice(0, 25).join(",")}${gaps.length > 25 ? " …" : ""}`);
    console.log(`  persian codepoints: ی=${persianYeh} ھ=${persianHeh} ک=${persianKaf}   (arabic ي=${arabicYeh} ه=${arabicHeh})`);
    console.log(`  reversed runs: ${revTotal}${revTotal ? "  " + revHits.map(([w, n]) => `${w}×${n}`).join(" ") : ""}`);
    console.log(`  ه-damage: ${hehTotal}${hehTotal ? "  " + hehHits.map(([w, n]) => `${w.trim()}×${n}`).join(" ") : ""}`);
  }
}

main();
