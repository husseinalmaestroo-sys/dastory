/**
 * Stages a law PDF's text layer to .txt, repairing codepoint-level transport
 * damage on the way out.
 *
 * The one repair applied here is Persian→Arabic letter folding. Some of these
 * PDFs are typeset with ی (U+06CC), ھ (U+06BE) or ک (U+06A9) where Arabic uses
 * ي, ه, ك. They render identically, so the file looks perfect and passes every
 * quality check — and then compares unequal to anything a user types on an
 * Arabic keyboard. The real property law carries 5170 ی and 2209 ھ, which
 * would have indexed as 224 articles that no query could ever reach.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-stage-textlayer.ts <in.pdf> <out.txt>
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { repairArticleHeaders } from "./tmp-header-repair";

/**
 * Persian/Urdu codepoints that are unambiguously Arabic letters in a Jordanian
 * statute. Safe to fold: no Jordanian legal text uses these letters natively,
 * so every occurrence is a typesetting artifact, and the fold is what makes the
 * text match a query.
 */
const PERSIAN_TO_ARABIC: [RegExp, string][] = [
  [/ی/g, "ي"], // ی → ي  farsi yeh
  [/ھ/g, "ه"], // ھ → ه  heh doachashmee
  [/ک/g, "ك"], // ک → ك  keheh
  [/گ/g, "ج"], // گ → ج  gaf (rare; only ever a mis-mapped jeem here)
];

export function foldPersianLetters(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = text;
  for (const [re, to] of PERSIAN_TO_ARABIC) {
    out = out.replace(re, () => {
      replaced++;
      return to;
    });
  }
  return { text: out, replaced };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: tmp-stage-textlayer.ts <in.pdf> <out.txt>");
    process.exit(1);
  }

  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
  const data = await pdfParse(await readFile(input));

  const folded = foldPersianLetters(data.text ?? "");
  const { text, fixed } = repairArticleHeaders(folded.text);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, text, "utf8");

  const arts = new Set([...text.matchAll(/المادة\s*\(?\s*(\d{1,3})/g)].map((m) => Number(m[1])));
  console.log(
    `${input}\n  ${data.numpages} pages, ${text.length} chars, ${arts.size} articles, ` +
      `${folded.replaced} persian letters folded, ${fixed} headers repaired -> ${output}`
  );
}

main();
