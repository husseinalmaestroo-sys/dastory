import "server-only";
import { normalizeDigits } from "../ingest/clean";

/**
 * Enforcement for ungrounded ("general knowledge") answers.
 *
 * WHY THIS IS CODE AND NOT A PROMPT INSTRUCTION
 *
 * A prompt is guidance, not a guarantee. Told "never cite an article number",
 * a model complies most of the time and then, on the request that matters,
 * writes "المادة 780 من القانون المدني تنص على…" with complete confidence and
 * the wrong number — because it is generating plausible text, not retrieving a
 * fact. No wording prevents this; the failure is in what a language model *is*.
 *
 * So the prompt asks, and this module enforces. Anything that looks like a
 * citation is stripped from an ungrounded answer before it ever reaches a
 * lawyer, regardless of what the model decided to write.
 *
 * The distinction being enforced is the one that matters professionally:
 *   "عقد المقاولة يخضع لأحكام القانون المدني"  — orientation, useful, harmless
 *   "المادة 780 من القانون المدني تنص على…"     — a fabricated citation
 *
 * Only grounded answers — built from retrieved chunks — may carry citations,
 * because only there does a real source back the number.
 */

/**
 * "المادة 780" / "مادة (5)" / "م. 12" — an article reference in any usual form.
 *
 * The `م.` alternative can't use `\b`: JS word boundaries are defined against
 * [A-Za-z0-9_], so there is never a boundary beside an Arabic letter and the
 * pattern would be dead. Guard with a lookbehind for a non-Arabic char instead,
 * so "م. 45" matches while the "م" inside a word like "رقم" does not.
 */
const ARTICLE_RE = /(?:ال)?ماد[ةه]\s*[({[]?\s*\d+[)}\]]?|(?<![؀-ۿ])م\s*\.\s*\d+/g;

/** "1234/2020" / "قرار رقم 55 لسنة 2019" — a decision reference. */
const DECISION_RE =
  /(?:قرار|حكم|طعن|تمييز)\s*(?:رقم\s*)?[({[]?\s*\d{1,6}\s*[/\-]\s*\d{4}|(?:رقم\s*)?\d{1,6}\s*\/\s*(?:19|20)\d{2}/g;

/**
 * "قانون رقم 8 لسنة 1996" — a law identified by number, and the far more common
 * "قانون العمل رقم 8 لسنة 1996", where the law's *name* sits between the kind
 * and the number. The first cut required "قانون" adjacent to "رقم" and missed
 * every named law — which is nearly all of them.
 *
 * The name is bounded to ~5 words so the pattern cannot swallow a sentence and
 * reach a "رقم" that belongs to something else.
 */
const LAW_NUMBER_RE =
  /(?:قانون|نظام|تعليمات)(?:\s+(?:معدل|ال[؀-ۿ]+|[؀-ۿ]+)){0,5}\s+رقم\s*[({[]?\s*\d+[)}\]]?(?:\s*لسنة\s*\d{4})?/g;

/**
 * A bare "لسنة 1996" left behind after the surrounding pattern took its number.
 * Swept last so an answer can't keep a dangling year that reads as a citation.
 */
const YEAR_RE = /لسنة\s*[({[]?\s*(?:19|20)\d{2}[)}\]]?/g;

export type CitationScan = {
  /** Every citation-shaped span found, verbatim. */
  found: string[];
  clean: boolean;
};

/**
 * Finds citation-shaped spans. Operates on digit-normalised text so that
 * "المادة ٧٨٠" is caught exactly like "المادة 780" — a model asked for Arabic
 * will often use Arabic-Indic digits, and a guard that misses those is no
 * guard at all.
 */
export function scanForCitations(text: string): CitationScan {
  const normalized = normalizeDigits(text);
  const found = [
    ...(normalized.match(LAW_NUMBER_RE) ?? []),
    ...(normalized.match(ARTICLE_RE) ?? []),
    ...(normalized.match(DECISION_RE) ?? []),
    ...(normalized.match(YEAR_RE) ?? []),
  ].map((s) => s.replace(/\s+/g, " ").trim());

  return { found: [...new Set(found)], clean: found.length === 0 };
}

export const REDACTION = "[رقم محجوب — غير مستند إلى قاعدة البيانات]";

export type Redaction = {
  text: string;
  redactedCount: number;
  redacted: string[];
};

/**
 * Replaces every citation-shaped span with a visible marker.
 *
 * Redacts rather than deletes: a lawyer reading a gap where a number should be
 * learns that the system withheld something and why. Silently deleting it
 * leaves prose that reads as complete and authoritative while the load-bearing
 * detail has vanished — worse than either the number or the marker.
 *
 * Runs on the digit-normalised text, so the returned string has ASCII digits
 * throughout. That is a deliberate trade: catching "المادة ٧٨٠" matters more
 * than preserving Arabic-Indic numerals in an answer that carries no citations
 * anyway.
 */
export function redactCitations(text: string): Redaction {
  const scan = scanForCitations(text);
  if (scan.clean) return { text, redactedCount: 0, redacted: [] };

  // Order matters. LAW_NUMBER_RE is widest and must run first — otherwise
  // ARTICLE_RE/DECISION_RE eat the number out of "قانون العمل رقم 8 لسنة 1996"
  // and leave the rest reading like a real citation with a hole in it.
  // YEAR_RE sweeps last for any dangling "لسنة 1996".
  let out = normalizeDigits(text);
  for (const re of [LAW_NUMBER_RE, ARTICLE_RE, DECISION_RE, YEAR_RE]) {
    out = out.replace(re, REDACTION);
  }

  return { text: out, redactedCount: scan.found.length, redacted: scan.found };
}

/**
 * Strips [n] citation markers that point past the retrieved source list.
 *
 * Grounded prompts (chat, drafting) all carry the same instruction — "لا
 * تستشهد بمصدر لم يُرفق لك" — but that's a sentence in a system prompt, not a
 * guarantee, and nothing previously checked that the model actually honoured
 * it. A [9] in the text with only 8 sources retrieved is a dead reference in
 * a chat answer and a wrong citation in a filed legal document either way —
 * both call sites need this, so it lives here next to redactCitations()
 * rather than duplicated per route.
 */
export function stripInvalidCitations(text: string, maxRef: number): { text: string; strippedCount: number } {
  let strippedCount = 0;
  const cleaned = text.replace(/\[(\d{1,2})\]/g, (match, numStr) => {
    const n = Number(numStr);
    if (n >= 1 && n <= maxRef) return match;
    strippedCount++;
    return "";
  });
  return { text: cleaned, strippedCount };
}

/** What verifyCitedNumbers needs from a retrieved chunk — nothing DB-shaped. */
export type CitableChunk = { article_number: string | null; decision_number: string | null; chunk_text?: string | null };

/**
 * Whether the cited chunk's own TEXT mentions this article/decision number —
 * a cross-reference ("مع مراعاة أحكام المادة 25 من هذا القانون") that the
 * answer legitimately repeats. Phase 2: such numbers used to be redacted
 * because they differ from the chunk's own article_number, which punished a
 * correct, verbatim-sourced reference.
 */
function mentionedInChunkText(chunk: CitableChunk, kind: "article" | "decision", number: string): boolean {
  if (!chunk.chunk_text) return false;
  const text = normalizeDigits(chunk.chunk_text);
  const n = normalizeCitedNumber(number);
  if (!n) return false;
  const re =
    kind === "article"
      ? new RegExp(`(?:ال)?ماد[ةه]\\s*[({[]?\\s*0*${n}(?!\\d)`)
      : new RegExp(`(?<!\\d)0*${n}\\s*[/\\-]\\s*\\d{4}`);
  return re.test(text);
}

// Same shapes as citation-verify.ts's ARTICLE_RE/DECISION_RE (captures the
// number instead of just matching it), reused here for a DIFFERENT reason —
// see verifyCitedNumbers' header comment for why this file doesn't call that
// one's DB-backed checker instead.
const CITED_ARTICLE_RE = /(?:ال)?ماد[ةه]\s*[({[]?\s*(\d+)[)}\]]?|(?<![؀-ۿ])م\s*\.\s*(\d+)/g;
const CITED_DECISION_RE =
  /(?:قرار|حكم|طعن|تمييز)\s*(?:رقم\s*)?[({[]?\s*(\d{1,6})\s*[/\-]\s*\d{4}|(?:رقم\s*)?(\d{1,6})\s*\/\s*(?:19|20)\d{2}/g;
const REF_RE = /\[(\d{1,2})\]/g;

// Empirically wider than citation-verify.ts's WINDOW=200: a real grounded
// answer often quotes the article's own text verbatim between the number and
// its bracket ("المادة (130) على أنه \"يعد عقدا ملزما...\" [2]"), and that
// quoted span alone can run 70-90 characters. 250 gives that comfortable
// margin without being so wide it could plausibly cross into an unrelated
// adjacent claim's own citation.
const NEARBY_WINDOW = 250;

function normalizeCitedNumber(s: string): string {
  return s.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * Checks article/decision numbers written in the grounded answer's PROSE
 * against the chunk their nearest [n] marker actually cites — not a fresh
 * database lookup (citation-verify.ts's job, for genuinely GPT-generated text
 * like the Type-2 supplement), but a check against something already known
 * with certainty: the exact chunk retrieval handed the model for [n] either
 * states the number it just wrote, or it doesn't.
 *
 * WHY THIS EXISTS INSTEAD OF REUSING citation-verify.ts's DB-BASED CHECKER
 *
 * That checker requires a "قانون … رقم N" mention within its own WINDOW of an
 * article number before accepting it — correct for Type 2's freer-form GPT
 * reasoning, where a bare "المادة 5" really is unverifiable (it exists in
 * dozens of unrelated laws with no [n] pinning it to one). But the grounded
 * prompt's own citation instruction is just "[1]" after each claim — it never
 * asks the model to restate a law's number every time, and a real live answer
 * confirmed this: three genuine, correct citations ("المادة (130)"/"(128)"/
 * "(17)"), none with a nearby law-number mention. Running the DB-based
 * checker on that text would have redacted all three — a regression on the
 * most common response type, not a fix. Checking against the cited chunk's
 * own metadata instead needs no DB round-trip at all and is more precise: it
 * is not asking "does this number exist anywhere in the corpus", it is asking
 * "does chunk N — the one the model itself pointed at — actually say this."
 *
 * A number with no [n] within NEARBY_WINDOW at all is treated the same as a
 * mismatch: unattributed, so unverifiable, so removed — same principle
 * citation-verify.ts already applies to a law-less article mention.
 */
export function verifyCitedNumbers(rawText: string, chunks: CitableChunk[]): { text: string; verifiedCount: number; redactedCount: number } {
  const text = normalizeDigits(rawText);
  const refs = [...text.matchAll(REF_RE)].map((m) => ({ index: m.index!, n: Number(m[1]) }));

  type Mention = { start: number; end: number; number: string; kind: "article" | "decision" };
  const mentions: Mention[] = [];
  for (const m of text.matchAll(CITED_ARTICLE_RE)) {
    mentions.push({ start: m.index!, end: m.index! + m[0].length, number: m[1] ?? m[2], kind: "article" });
  }
  for (const m of text.matchAll(CITED_DECISION_RE)) {
    mentions.push({ start: m.index!, end: m.index! + m[0].length, number: m[1] ?? m[2], kind: "decision" });
  }
  if (mentions.length === 0) return { text: rawText, verifiedCount: 0, redactedCount: 0 };
  mentions.sort((a, b) => a.start - b.start);

  let verifiedCount = 0;
  const badSpans: { start: number; end: number }[] = [];

  for (const mention of mentions) {
    // The prompt places "[n]" AFTER the fact it supports, and citations sit
    // densely (one after nearly every claim, per CLOSED_DOMAIN_RULES) — so
    // the marker for THIS mention is almost always the next one that appears
    // after it, never the previous claim's own marker sitting just before it.
    // A real answer caught this precisely: "المادة (130)…[2]، والمادة (128)"
    // has [2] only ~5 chars before "المادة (128)" but [3] — its real
    // citation — ~50 chars after; nearest-by-raw-distance picked [2] and
    // wrongly redacted a correct citation. Prefer forward, and only fall back
    // to a preceding marker when nothing follows within window at all (e.g.
    // the very last claim in the answer, or an unusual "[n] الماداة …" order).
    let nearestN: number | null = null;
    let nearestDist = Infinity;
    for (const ref of refs) {
      if (ref.index < mention.end) continue;
      const dist = ref.index - mention.end;
      if (dist <= NEARBY_WINDOW && dist < nearestDist) {
        nearestN = ref.n;
        nearestDist = dist;
      }
    }
    if (nearestN === null) {
      for (const ref of refs) {
        if (ref.index >= mention.start) continue;
        const dist = mention.start - ref.index;
        if (dist <= NEARBY_WINDOW && dist < nearestDist) {
          nearestN = ref.n;
          nearestDist = dist;
        }
      }
    }

    const chunk = nearestN !== null ? chunks[nearestN - 1] : undefined;
    const actual = chunk ? (mention.kind === "article" ? chunk.article_number : chunk.decision_number) : null;
    const matches =
      (actual != null && normalizeCitedNumber(actual) === normalizeCitedNumber(mention.number)) ||
      (chunk !== undefined && mentionedInChunkText(chunk, mention.kind, mention.number));

    if (matches) verifiedCount++;
    else badSpans.push({ start: mention.start, end: mention.end });
  }

  if (badSpans.length === 0) return { text: rawText, verifiedCount, redactedCount: 0 };

  let out = "";
  let cursor = 0;
  for (const span of badSpans) {
    out += text.slice(cursor, span.start) + REDACTION;
    cursor = span.end;
  }
  out += text.slice(cursor);

  return { text: out, verifiedCount, redactedCount: badSpans.length };
}
