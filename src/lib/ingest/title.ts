import "server-only";
import { basename, extname } from "node:path";
import { normalizeDigits } from "./clean";

const TATWEEL = /ـ/g;
// Harakat (U+064B–U+065F) and the superscript alef (U+0670) — written as
// escapes: a literal range "ً-ٰ" also spans the Arabic-Indic digits
// (U+0660–U+0669) and silently deleted "٤٦" from "رقم (٤٦)".
const DIACRITICS = /[\u064B-\u065F\u0670]/g;
const ZERO_WIDTH = /[​-‏‪-‮﻿]/g;

/**
 * A source title as it should be stored and shown on a citation card (corpus
 * repair, 2026-10). Titles came from download file names, which carry
 * justification tatweel ("قانــــــون العفو العام رقـم 5 لسنـــــة 2024"),
 * underscores, Arabic-Indic digits, a bracketed number ("رقم (٤٦)") and, from
 * PDF ligature damage, a reversed lam-alef at a word start ("التنظيم اإلداري").
 * Tatweel inside "رقـم" also hid the law number from parseLawNumber.
 *
 * Only presentation is changed — never a word: the reversed lam-alef is
 * repaired only where it is unambiguous (an alef followed directly by a
 * hamzated alef never occurs in correct Arabic), and an ambiguous mid-word
 * inversion ("اتالف") is left alone.
 */
export function normalizeTitle(raw: string): string {
  let t = raw.normalize("NFKC").replace(ZERO_WIDTH, "").replace(TATWEEL, "").replace(DIACRITICS, "");
  t = normalizeDigits(t);
  t = t.replace(/\.(?:pdf|txt|docx?|html?)$/i, "");
  t = t.replace(/_+/g, " ");
  t = t.replace(/رقم\s*[([{]\s*(\d{1,5})\s*[)\]}]/g, "رقم $1");
  t = t.replace(/(^|\s)ا([إأآ])ل/g, "$1ال$2");
  return t.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Filename minus extension, tidied into something readable in the admin table. */
export function titleFromPath(path: string): string {
  return normalizeTitle(basename(path, extname(path)).replace(/[_-]+/g, " "));
}

/**
 * What is wrong with a stored title, if anything (the inventory reports it).
 *   unnormalized       carries tatweel, diacritics, underscores, Arabic-Indic
 *                      digits or a bracketed number — normalize-titles fixes it
 *   malformed_citation "لسنة" followed by something that is not a year
 *                      ("قانون الملكية العقارية لسنة أحكام عامة") — the number
 *                      and year must come from the official text, not a guess
 */
export function titleProblems(title: string): ("unnormalized" | "malformed_citation")[] {
  const out: ("unnormalized" | "malformed_citation")[] = [];
  if (normalizeTitle(title) !== title.replace(/\s+/g, " ").trim()) out.push("unnormalized");
  const t = normalizeTitle(title);
  if (/(?:^|\s)(?:لسنة|لسنه|لعام)\s+(?!\d)/.test(t) || /(?:لسنة|لسنه|لعام)\s*$/.test(t)) out.push("malformed_citation");
  return out;
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
