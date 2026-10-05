import "server-only";
import { normalizeDigits } from "./clean";

/**
 * Pure parsing of a law's citation identity out of its title.
 *
 * These functions never touch the database and never guess beyond what the
 * text says — like metadata.ts, an unsure answer is `null`, not a plausible
 * fabrication, because a wrong law number is a wrong citation. They are shared
 * by the ingest validation gate (validate.ts), the admin upload route, the
 * bulk-ingest CLI, and the amendment-backfill script, so the rule for "what is
 * the number of قانون العمل رقم 8 لسنة 1996" lives in exactly one place.
 */

/**
 * Digits normalised and justification tatweel / diacritics removed: a title
 * taken from a file name ("قانــــون العفو العام رقـم 5 لسنـــــة 2024") hid its
 * number from these parsers (corpus repair, 2026-10).
 */
function withoutMarks(title: string): string {
  return normalizeDigits(title).replace(/[\u0640\u064B-\u065F\u0670]/g, "");
}

/**
 * True when a title names an amending act rather than an original law.
 *
 * Jordanian amending laws are titled "قانون معدّل لقانون X" / "نظام معدل لنظام
 * X" — the marker word is معدل/معدّل near the front. An original law never
 * calls itself معدل. The check is anchored to the leading kind-word so that a
 * law whose *subject* merely mentions تعديل in a later clause is not misread as
 * an amendment.
 */
export function isAmendingTitle(title: string): boolean {
  const t = withoutMarks(title).trim();
  // "قانون معدل ...", "قانون معدّل ...", "معدل لقانون ...", "نظام معدل لنظام ..."
  //
  // The end-of-token guard is `(?![؀-ۿ])`, NOT `\b`. JavaScript's `\b` is
  // defined against [A-Za-z0-9_], so it never matches after an Arabic letter —
  // written with `\b` this pattern was dead (verify caught it). The lookahead
  // also stops "معدلات" (rates) from reading as "معدّل".
  return /^(?:ال)?(?:قانون|نظام|تعليمات)?\s*معد[ّ]?ل(?![؀-ۿ])/.test(t);
}

/**
 * The law's own number: "قانون العمل رقم 8 لسنة 1996" → "8",
 * "قانون رقم (12) لسنة 2025" → "12". Returns null when the title carries no
 * "رقم N" — many consolidated titles ("القانون المدني") state only a year, and
 * the caller must then supply the number explicitly rather than have one
 * invented here.
 */
export function parseLawNumber(title: string): string | null {
  const t = withoutMarks(title);
  const m = t.match(/رقم\s*[({\[]?\s*(\d{1,5})\s*[)}\]]?/);
  return m ? m[1] : null;
}

/**
 * The law's year: the "لسنة/لعام YYYY" nearest a "رقم" if present, else the
 * newest plausible 4-digit year in the title. Bounded to real legislative
 * years so a stray number is not read as one.
 */
export function parseLawYear(title: string): number | null {
  const t = withoutMarks(title);
  const now = new Date().getFullYear();

  const framed = t.match(/(?:لسنة|لعام|سنة|عام)\s*(\d{4})/);
  if (framed) {
    const y = Number(framed[1]);
    if (y >= 1900 && y <= now + 1) return y;
  }

  const all = [...t.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((y) => y >= 1900 && y <= now + 1);
  return all.length ? Math.max(...all) : null;
}

/**
 * The base-law name an amending title points at, stripped of the معدل wrapper
 * and its own number tail — used to find the original in the corpus.
 *
 *   "قانون معدل لقانون العقوبات رقم 10 لسنة 2022" → "قانون العقوبات"
 *   "نظام معدل لنظام المساعدة القانونية رقم 53 لسنة 2022" → "نظام المساعدة القانونية"
 *
 * Returns null for a title that is not an amendment (there is no base to name).
 * Deliberately conservative: it extracts the "لقانون/لنظام …" clause and trims
 * the number/year, matching on the *name*, because law numbers of the amendment
 * and the original differ and only the name is shared.
 */
export function baseLawName(title: string): string | null {
  if (!isAmendingTitle(title)) return null;

  const t = withoutMarks(title).replace(/\s+/g, " ").trim();

  // Grab the "ل(قانون|نظام|تعليمات) <name>" the amendment refers to.
  const m = t.match(/ل(قانون|نظام|تعليمات)\s+(.+)$/);
  if (!m) return null;

  const kind = m[1];
  let name = m[2];

  // Cut everything from the number/year tail onward. The token guard is
  // `(?![؀-ۿ])`, not `\b` — `\b` never fires after an Arabic letter, so `رقم\b`
  // is dead and the tail would survive (this is the bug verify caught here).
  name = name.replace(/\s*(?:رقم|لسنة|لعام|سنة|عام)(?![؀-ۿ]).*$/, "").trim();
  // Drop a trailing "وتعديلاته" — the base may or may not carry it.
  name = name.replace(/\s*وتعديلات[هي]?\s*$/, "").trim();

  if (name.length < 2) return null;
  return `${kind} ${name}`.replace(/\s+/g, " ").trim();
}
