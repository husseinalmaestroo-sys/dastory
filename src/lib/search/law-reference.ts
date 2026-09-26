import "server-only";
import { foldForSearch } from "../ingest/clean";
import { query } from "../db";

/**
 * Which law a question names — "المادة 17 من قانون العمل" → قانون العمل.
 *
 * WHY THIS EXISTS (Phase 2)
 *
 * parseIntent extracted article numbers but not the law they belong to, and
 * the exact-citation arm matched `article_number = ANY($6)` across the whole
 * corpus with no ORDER BY and LIMIT 30. With ~60 laws in the index, "المادة 17
 * من قانون العمل" boosted article 17 of up to 30 ARBITRARY laws to the top
 * (+1 each, more than every ranked arm combined) — and could leave the
 * requested law's own article 17 out of the arbitrary 30. Worse, قانون العمل
 * is one of the core laws recorded as missing from the corpus
 * (deploy/sources/jordan-core-laws-missing.txt), so the old behaviour
 * answered a Labour-Law question with another law's article of the same
 * number. This module lets retrieval (a) scope the exact arm to the named
 * law and (b) say plainly when the named law is not in the corpus at all.
 *
 * Deliberately conservative: an unsure parse returns null (no scoping, the
 * old behaviour), never a guessed law.
 */

export type LawReference = {
  /** Folded "kind + name" used for matching, e.g. "قانون العمل". */
  key: string;
  /** As the lawyer wrote it (unfolded). Never echoed into an answer. */
  display: string;
  /** Folded name words after the kind word, in order (for prefix matching). */
  nameWords?: string[];
  kind?: string;
};

const KIND_RE = /^(?:[وبلف])?(قانون|نظام|تعليمات)$/;
// "القانون المدني" and friends: the definite form names a law only with one of
// these adjectives ("القانون يجيز…" is generic, not a law name).
const DEFINITE_LAW_ADJECTIVES = new Set(["المدني", "التجاري", "الجزائي", "الاداري", "الدولي"]);
const DEFINITE_LAW_FORMS = new Set(["القانون", "والقانون", "فالقانون", "بالقانون", "للقانون", "وبالقانون", "وللقانون"]);

// Folded forms. A name stops at the first of these (or at a number).
const STOP = new Set([
  "في", "علي", "عن", "من", "الي", "حول", "بشان", "بخصوص", "بخصوصها", "ضمن", "وفق", "وفقا", "حسب", "بموجب",
  "التي", "الذي", "الذين", "ما", "ماذا", "هل", "كيف", "متي", "لماذا", "و", "او", "ام", "ثم", "بين", "مع", "كما",
  "اذا", "ان", "انه", "حيث", "لسنه", "رقم", "سنه", "عام", "لعام", "المعدل", "المعدله", "النافذ", "الساري",
  "الجديد", "القديم", "الحالي", "المذكور", "المعني", "المختص", "المطبق", "الواجب", "نفسه", "ذاته", "هذا",
  "هذه", "ذلك", "تلك", "المشار", "اليه", "الاردني", "الاردنيه", "يجوز", "يحق", "يلزم", "يعاقب", "يعتبر",
  "يشترط", "ينص", "تنص", "نص", "نصت", "يحدد", "حدد", "ينظم", "نظم", "اجاز", "يمنع", "منع", "يطبق", "تطبق",
  "يسري", "تسري", "يتضمن", "تتضمن", "وما", "فما", "لا", "لم", "لن", "قد", "كل", "اي", "على",
]);
// A "name" of only these words is not a law name ("قانون جديد", "نظام معين").
const GENERIC_NAMES = new Set(["جديد", "معين", "خاص", "عام", "اخر", "سابق", "لاحق", "ساري", "نافذ"]);

const MAX_NAME_WORDS = 4;

function tokens(text: string): { folded: string; raw: string }[] {
  // Punctuation → space; keep letters and digits.
  const raw = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return raw.map((r) => ({ raw: r, folded: foldForSearch(r) }));
}

/** The first law the question names, or null. */
export function extractLawReference(question: string): LawReference | null {
  return extractAllLawReferences(question)[0] ?? null;
}

/** Every law the text names, in order of appearance (deduplicated by key). */
export function extractAllLawReferences(text: string): LawReference[] {
  const found: LawReference[] = [];
  const push = (r: LawReference) => {
    if (!found.some((f) => f.key === r.key)) found.push(r);
  };
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].folded;

    // "القانون المدني" — definite form (with an optional و/ف/ب/ل prefix) + a known adjective.
    if (DEFINITE_LAW_FORMS.has(t) && i + 1 < toks.length && DEFINITE_LAW_ADJECTIVES.has(toks[i + 1].folded)) {
      push({ key: `القانون ${toks[i + 1].folded}`, display: `${toks[i].raw} ${toks[i + 1].raw}` });
      continue;
    }
    if (t === "الدستور" || t === "للدستور" || t === "بالدستور") {
      push({ key: "الدستور", display: "الدستور" });
      continue;
    }

    const kind = t.match(KIND_RE);
    if (!kind) continue;
    // "تعليمات نظام …" / "نظام قانون …" are not law names (the first is how an
    // injection says "system instructions").
    if (i + 1 < toks.length && KIND_RE.test(toks[i + 1].folded)) continue;
    if (i > 0 && KIND_RE.test(toks[i - 1].folded)) continue;
    const name: { folded: string; raw: string }[] = [];
    for (let j = i + 1; j < toks.length && name.length < MAX_NAME_WORDS; j++) {
      const w = toks[j];
      if (STOP.has(w.folded) || /\d/.test(w.folded)) break;
      name.push(w);
    }
    if (name.length === 0 || name.every((w) => GENERIC_NAMES.has(w.folded))) continue;
    push({
      key: `${kind[1]} ${name.map((w) => w.folded).join(" ")}`,
      display: `${kind[1]} ${name.map((w) => w.raw).join(" ")}`,
      nameWords: name.map((w) => w.folded),
      kind: kind[1],
    });
  }
  return found;
}

/**
 * Resolves a reference against corpus titles, tolerating trailing words the
 * extractor could not tell apart from the name ("قانون العمل التجريبي قبل
 * التعديل", "قانون العقوبات تعاقب بالإعدام"): the longest prefix of the name
 * that matches a title wins. A prefix never drops below two name words when
 * the name has two or more — "قانون حماية المستهلك" must not fall back to
 * "قانون حماية" and match "قانون حماية البيئة".
 */
export function resolveAgainstTitles(ref: LawReference, titles: SourceTitle[]): { ref: LawReference; sourceIds: number[] } {
  const words = ref.nameWords;
  if (!words || !ref.kind) return { ref, sourceIds: matchLawTitles(ref, titles) };
  const min = Math.min(2, words.length);
  for (let n = words.length; n >= min; n--) {
    const candidate: LawReference = { ...ref, key: `${ref.kind} ${words.slice(0, n).join(" ")}`, nameWords: words.slice(0, n) };
    const ids = matchLawTitles(candidate, titles);
    if (ids.length > 0) return { ref: candidate, sourceIds: ids };
  }
  return { ref: { ...ref, key: `${ref.kind} ${words.slice(0, min).join(" ")}`, nameWords: words.slice(0, min) }, sourceIds: [] };
}

/**
 * Whether a source is the law `ref` names — used by grounding.ts to catch
 * "according to <law X> [n]" when [n] comes from another law. True when the
 * source's own law name contains the named law at a word boundary, or its
 * title starts with it (the matchLawTitles rule, incl. amending acts). A
 * regulation merely issued under the law ("نظام … الصادر بموجب قانون العمل")
 * is not the law.
 */
export function sourceIsLaw(ref: LawReference, source: { lawName?: string | null; title?: string | null }): boolean {
  const bare = ref.key.replace(/^ال/, "");
  if (source.lawName) {
    const ln = foldForSearch(source.lawName);
    if (new RegExp(`^(?:ال)?${escapeRe(bare)}(\\s|$)`).test(ln)) return true;
  }
  if (source.title && matchLawTitles(ref, [{ id: 0, folded: foldForSearch(source.title) }]).length > 0) return true;
  return false;
}

// ---- matching against the corpus --------------------------------------------

type SourceTitle = { id: number; folded: string };
let titleCache: { at: number; rows: SourceTitle[] } | null = null;
// legal_sources is small (hundreds of rows); folding every title in JS with
// the exact function the question was folded with is both simpler and more
// faithful than re-implementing foldForSearch in SQL. A new source becomes
// matchable within TITLE_TTL_MS.
const TITLE_TTL_MS = 5 * 60_000;

async function sourceTitles(): Promise<SourceTitle[]> {
  if (titleCache && Date.now() - titleCache.at < TITLE_TTL_MS) return titleCache.rows;
  const rows = await query<{ id: string | number; title: string }>(
    `SELECT id, title FROM legal_sources WHERE status = 'ready' AND jurisdiction = 'JO'`
  );
  titleCache = { at: Date.now(), rows: rows.map((r) => ({ id: Number(r.id), folded: foldForSearch(r.title) })) };
  return titleCache.rows;
}

/** Test hook. */
export function resetLawTitleCache(): void {
  titleCache = null;
}

/**
 * Source ids whose title names this law. Matches the folded key as a
 * whole-word substring of the folded title, and requires the title to START
 * with the key (after an optional "ال") or with "قانون معدل ل…" of it — so
 * "قانون العمل" matches "قانون العمل رقم 8 لسنة 1996" and its amending
 * "قانون معدل لقانون العمل…", but not "نظام العاملين في قانون العمل…".
 */
export function matchLawTitles(ref: LawReference, titles: SourceTitle[]): number[] {
  const key = ref.key;
  const bareKey = key.replace(/^ال/, "");
  return titles
    .filter(({ folded }) => {
      const t = folded.trim();
      const startsWith = (s: string) => t === s || t.startsWith(`${s} `);
      if (startsWith(key) || startsWith(bareKey) || startsWith(`ال${bareKey}`)) return true;
      // Amending acts: "قانون معدل لقانون العمل ..."
      return new RegExp(`^(?:قانون|نظام|تعليمات)\\s+معد[ّ]?ل\\s+ل${escapeRe(bareKey)}(?:\\s|$)`).test(t);
    })
    .map((r) => r.id);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function resolveLawSourceIds(ref: LawReference): Promise<number[]> {
  return resolveAgainstTitles(ref, await sourceTitles()).sourceIds;
}

export async function resolveLawReference(ref: LawReference): Promise<{ ref: LawReference; sourceIds: number[] }> {
  return resolveAgainstTitles(ref, await sourceTitles());
}
