import "server-only";
import { basename, extname } from "node:path";

/** Filename minus extension, tidied into something readable in the admin table. */
export function titleFromPath(path: string): string {
  return basename(path, extname(path))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// The marks Windows and humans leave on duplicated files.
const COPY_MARKERS = /copy|duplicate|نسخة|\(\d+\)|\bcopie\b|_copy|\bnew\b/i;
const PLACEHOLDER = /^(scan|img|image|doc|document|untitled|new)[\s_-]*\d*$/i;

/**
 * Ranks a filename as a source title — lower is better.
 *
 * Used only to choose between byte-identical duplicates. Picking by directory
 * order instead means the winner is decided by filename sort, which routinely
 * keeps "DUPLICATE_copy.pdf" over "qarar_1234_2020.pdf". The title is shown in
 * the admin table and on every citation card, so the choice is visible to a
 * lawyer reading sources.
 */
export function titleScore(title: string): number {
  const t = title.trim();
  let score = 0;

  if (COPY_MARKERS.test(t)) score += 100;
  if (PLACEHOLDER.test(t)) score += 50;
  // "qarar 1234 2020" identifies the source; "final version" does not.
  if (!/\d{3,}/.test(t)) score += 10;
  // Tie-break: the longer name usually carries more metadata. Capped so a
  // rambling name cannot outweigh a copy marker.
  score -= Math.min(t.length, 60) / 100;

  return score;
}

/** Picks the best title among duplicates. Never mutates the input. */
export function pickBestTitled<T extends { title: string }>(group: T[]): T {
  return [...group].sort((a, b) => titleScore(a.title) - titleScore(b.title))[0];
}
