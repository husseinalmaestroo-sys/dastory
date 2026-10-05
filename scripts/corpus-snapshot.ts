/**
 * Comparable corpus snapshots (Phase 2.4). Read-only.
 *
 *   npm run corpus:snapshot -- --out snapshot-before.json
 *   npm run corpus:snapshot -- --compare snapshot-before.json snapshot-after.json [--md diff.md]
 *
 * Take one before any migration or repair and one after; the comparison lists,
 * row by row, every field that changed and every source whose TEXT changed
 * (which no repair should do) — and that nothing was deleted. Works on any
 * schema version. src/lib/corpus/snapshot.ts.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createPool } from "../src/lib/db-pool";
import { describeTarget, targetLine } from "../src/lib/db-target";
import { compareSnapshots, diffMarkdown, takeSnapshot, type CorpusSnapshot } from "../src/lib/corpus/snapshot";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const compare = process.argv.indexOf("--compare");
  if (compare >= 0) {
    const [fa, fb] = [process.argv[compare + 1], process.argv[compare + 2]];
    if (!fa || !fb) throw new Error("--compare needs two snapshot files.");
    const a = JSON.parse(readFileSync(fa, "utf8")) as CorpusSnapshot;
    const b = JSON.parse(readFileSync(fb, "utf8")) as CorpusSnapshot;
    const d = compareSnapshots(a, b);
    const md = diffMarkdown(d, a, b);
    const out = arg("md");
    if (out) writeFileSync(out, md);
    else process.stdout.write(md);
    console.log(`Compared: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed, ${d.textChanges} text change(s).`);
    // Removing a source or changing a text is never what a repair does.
    process.exit(d.removed.length > 0 || d.textChanges > 0 ? 3 : 0);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const target = describeTarget(url);
  console.log(`Target: ${targetLine(target)}`);
  const pool = createPool(url, { max: 1 });
  try {
    const snap = await takeSnapshot(pool, target as unknown as Record<string, unknown>);
    const out = arg("out") ?? `snapshot-${snap.takenAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(out, JSON.stringify(snap));
    console.log(`Snapshot: ${snap.sources.length} sources, ${snap.sources.reduce((n, s) => n + s.chunks, 0)} chunks → ${out}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("snapshot failed:", (err as Error).message.replace(/\/\/[^@\s]+@/g, "//…@"));
  process.exit(1);
});
