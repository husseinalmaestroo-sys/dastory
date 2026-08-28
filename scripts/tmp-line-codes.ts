/** Prints the exact codepoints of lines matching a pattern. Args: <file> <regex> [max] */
import { readFile } from "node:fs/promises";

async function main() {
  const [file, pattern, maxRaw] = process.argv.slice(2);
  const re = new RegExp(pattern);
  const lines = (await readFile(file, "utf8")).split("\n");
  let shown = 0;

  for (const [i, line] of lines.entries()) {
    if (!re.test(line)) continue;
    const cps = [...line]
      .map((c) => (c === " " ? "SP" : /[؀-ۿ]/.test(c) ? `${c}` : `${c}`))
      .map((c, j) => `${c}=${[...line][j].codePointAt(0)!.toString(16)}`)
      .join(" ");
    console.log(`L${i + 1}: ${JSON.stringify(line)}\n     ${cps}\n`);
    if (++shown >= Number(maxRaw ?? 3)) break;
  }
}

main();
