/**
 * Article-header repair, shared by the text-layer and OCR staging paths.
 *
 * chunk.ts finds articles with an ARTICLE_RE anchored to the start of a line,
 * and cleanText only protects a line from being rejoined when it opens with
 * "المادة". So anything that displaces or decorates the header — a reordered
 * "(1المادة )", a leading dash, an OCR asterisk, an interposed "رقم" — turns a
 * citable article into anonymous prose. Nothing errors; the text still embeds
 * and still retrieves. It just can never be cited as "المادة 13" again.
 *
 * Run as a CLI to repair a staged file in place:
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-header-repair.ts <file.txt...>
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

export function repairArticleHeaders(text: string): { text: string; fixed: number } {
  let fixed = 0;
  const bump = <T extends string>(v: T): T => {
    fixed++;
    return v;
  };

  let out = text;

  // ": (1المادة )" → "المادة (1):" — extraction carried the colon and the
  // opening paren + digit to the front of the line (the real property law).
  out = out.replace(/^[ \t]*:?[ \t]*\(\s*(\d+)\s*((?:ال)?مادة)\s*\)/gm, (_m, n: string, w: string) =>
    bump(`${w} (${n}):`)
  );

  // "-المادة1" / "*المادة ( 5 )" → drop the leading mark. Anchored on مادة so
  // it cannot strip the bullet from an ordinary list item. The asterisk is an
  // OCR artifact: the income tax scan prints a marginal footnote star that
  // tesseract reads as part of the header, on 10 of its articles.
  out = out.replace(/^[ \t]*[-–—:.*#•]+[ \t]*((?:ال)?مادة\s*[({[]?\s*\d)/gm, (_m, rest: string) =>
    bump(rest)
  );

  // "المادة رقم (8)" → "المادة (8)". ARTICLE_RE allows only brackets and
  // spaces between the word and its number, so an interposed "رقم" hides it.
  out = out.replace(/^([ \t]*(?:ال)?مادة)\s+رقم\s*(?=[({[]?\s*\d)/gm, (_m, head: string) =>
    bump(`${head} `)
  );

  // "المادة7" / "المادة(1)" → insert the space cleanText's rejoin guard needs
  // before it will treat the line as structural rather than wrapped prose.
  out = out.replace(/^([ \t]*(?:ال)?مادة)(?=[\d({[])/gm, (_m, head: string) => bump(`${head} `));

  return { text: out, fixed };
}

async function main() {
  for (const f of process.argv.slice(2)) {
    const before = await readFile(f, "utf8");
    const { text, fixed } = repairArticleHeaders(before);
    if (fixed > 0) await writeFile(f, text, "utf8");
    console.log(`  ${String(fixed).padStart(4)} header(s) repaired  ${basename(f)}`);
  }
}

// Only run the CLI when invoked directly, not when imported for the function.
if (process.argv[1] && /tmp-header-repair\.ts$/.test(process.argv[1])) main();
