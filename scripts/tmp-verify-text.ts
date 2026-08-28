/**
 * Checks extracted Arabic for exact logical-order strings. Visual inspection in
 * a terminal cannot settle this: a bidi-capable display reorders what it shows,
 * so correct text can look scrambled and scrambled text can look fine. Only
 * codepoint comparison is trustworthy.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-verify-text.ts <file> [...words]
 */
import { readFile } from "node:fs/promises";

/** Words every Jordanian statute contains, in correct logical order. */
const EXPECTED = [
  "المادة",
  "القانون",
  "الوزير",
  "على",
  "في",
  "من",
  "التي",
  "هذا",
];

async function main() {
  const [file, ...extra] = process.argv.slice(2);
  const text = await readFile(file, "utf8");
  const words = [...EXPECTED, ...extra];

  console.log(`${file}  (${text.length} chars)\n`);
  for (const w of words) {
    const n = text.split(w).length - 1;
    const cps = [...w].map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ");
    console.log(`  ${n > 0 ? "✓" : "✗"} ${String(n).padStart(4)} × ${w.padEnd(12)} [${cps}]`);
  }

  // Presentation forms (U+FB50–U+FEFF) mean the extractor emitted display
  // glyphs rather than characters — searchable text must not contain them.
  const presentation = (text.match(/[ﭐ-﻿]/g) ?? []).length;
  const lamAlef = (text.match(/[ﻵ-ﻼ]/g) ?? []).length;
  console.log(`\n  presentation-form glyphs: ${presentation}  (of which lam-alef: ${lamAlef})`);
}

main();
