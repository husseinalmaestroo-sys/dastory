import "server-only";

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ZERO_WIDTH = /[​-‏‪-‮﻿]/g;

/** Arabic-Indic ٠-٩ and extended ۰-۹ → ASCII. */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Cleans extracted PDF text for storage and embedding.
 *
 * Deliberately conservative: this output is what we quote back to a lawyer as
 * statute text, so it fixes transport damage (ligatures, zero-width marks, PDF
 * line-wrapping) and stops there. It does NOT fold alef/ya/ta-marbuta
 * variants — that is a search-time concern, and doing it here would corrupt
 * proper nouns in a quote.
 */
export function cleanText(raw: string): string {
  let t = raw;

  t = t.normalize("NFKC"); // splits Arabic presentation-form ligatures
  t = t.replace(ZERO_WIDTH, "");
  t = t.replace(TATWEEL, "");
  t = t.replace(ARABIC_DIACRITICS, "");
  t = normalizeDigits(t);

  t = t.replace(/\r\n?/g, "\n");
  t = t.replace(/[ \t ]+/g, " ");

  // PDF extraction hard-wraps prose at the page's visual column. Rejoin a line
  // into its predecessor unless the break looks structural — a new article, a
  // list item, or a sentence end.
  //
  // The article guard matches "المادة" followed by whitespace, a digit, or an
  // opening bracket. Requiring whitespace alone was too strict: real sources
  // write the header tight against its number as "المادة7" or "المادة(1):",
  // and for those the guard did not fire, so the header was folded into the
  // paragraph above it. chunk.ts anchors ARTICLE_RE with ^, so a header that
  // is no longer a line start is simply not an article — silently, with no
  // error anywhere. That cost the arbitration law 34 of its 56 articles and
  // the consumer protection law 5 of 27.
  //
  // The lookahead's gap between the newline and "المادة" was originally
  // `[\n؀-ۿ]*?` — newlines or Arabic-block characters only. moj.gov.jo's own
  // PDFs render a blank paragraph-spacing line as "\n \n \n  " (a lone ASCII
  // space per empty line, not a truly empty line), so a plain space — not in
  // either class — sat between the last newline and "المادة" and the guard
  // missed it every time. That silently cost the civil code 1,266 of its
  // 1,442 real articles (only 176 survived as recognisable line starts) even
  // though the raw extraction itself had all 1,450 "المادة (N)" markers
  // sitting cleanly at line-starts before this function touched them. Widened
  // to `[\s؀-ۿ]*?` (any whitespace, not just \n) to cover it.
  t = t.replace(/([^\n.:؛؟!])\n(?![\s؀-ۿ]*?(?:المادة|مادة)[\s\d({[]|\s*[-•*]|\s*\d+[.)])/g, "$1 ");

  t = t.replace(/\n{3,}/g, "\n\n");
  t = t
    .split("\n")
    .map((l) => l.trim())
    .join("\n");

  // Page furniture: standalone page numbers and "صفحة 3 من 40" lines.
  t = t.replace(/^\s*-?\s*\d{1,4}\s*-?\s*$/gm, "");
  t = t.replace(/^\s*صفحة\s*\d+\s*(?:من\s*\d+)?\s*$/gm, "");

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Search-time normalisation only. Folds orthographic variants so that a query
 * for "اجراءات" matches stored "إجراءات". Never persisted as document text.
 */
export function foldForSearch(text: string): string {
  return cleanText(text)
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase();
}
