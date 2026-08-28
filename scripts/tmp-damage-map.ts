/**
 * Localises damage in a staged .txt. Whole-file token counts say how much of a
 * document is broken but not *where*, and that decides the route: damage
 * confined to running headers is ignorable, damage inside article bodies means
 * the text layer has to be thrown away and the pages re-read by OCR.
 *
 * Reports, per line: whether it contains reversed function words (bidi applied
 * twice) or ه→ى/و substitution, plus a sample of the worst offenders.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-damage-map.ts <file.txt>
 */
import { readFile } from "node:fs/promises";

const REVERSED = /(?<![؀-ۿ])(?:يف|نم|ىلع|اذه|يتلا|نوناقلا|ةداملا|ةنس|نوكي)(?![؀-ۿ])/g;
/** "لو" is excluded deliberately — it is a real Arabic word ("if"), not damage. */
const HEH_DAMAGE = /(?<![؀-ۿ])(?:ىذا|ىذه|بو|فيو|منو|عليو|بيا|ىي|ىو|ليا|ميا)(?![؀-ۿ])/g;
const CLEAN = /(?<![؀-ۿ])(?:في|من|على|هذا|التي|القانون|المادة)(?![؀-ۿ])/g;

async function main() {
  const file = process.argv[2];
  const lines = (await readFile(file, "utf8")).split("\n");

  let dirtyRev = 0;
  let dirtyHeh = 0;
  let cleanLines = 0;
  let blank = 0;
  const samples: { n: number; kind: string; text: string }[] = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return void blank++;
    const rev = (t.match(REVERSED) ?? []).length;
    const heh = (t.match(HEH_DAMAGE) ?? []).length;
    const ok = (t.match(CLEAN) ?? []).length;

    if (rev > 0) {
      dirtyRev++;
      if (samples.filter((s) => s.kind === "REV").length < 6)
        samples.push({ n: i + 1, kind: "REV", text: t.slice(0, 110) });
    } else if (heh > 0) {
      dirtyHeh++;
      if (samples.filter((s) => s.kind === "HEH").length < 6)
        samples.push({ n: i + 1, kind: "HEH", text: t.slice(0, 110) });
    } else if (ok > 0) cleanLines++;
  });

  const content = lines.length - blank;
  const pct = (n: number) => `${((n / content) * 100).toFixed(1)}%`;

  console.log(`\n${file}`);
  console.log(`  content lines : ${content}`);
  console.log(`  reversed      : ${dirtyRev} (${pct(dirtyRev)})`);
  console.log(`  ه-substituted : ${dirtyHeh} (${pct(dirtyHeh)})`);
  console.log(`  clean w/ token: ${cleanLines} (${pct(cleanLines)})`);
  console.log(`\n  samples:`);
  for (const s of samples) console.log(`    [${s.kind} L${s.n}] ${s.text}`);
}

main();
