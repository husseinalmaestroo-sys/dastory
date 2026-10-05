import "server-only";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { query } from "../db";
import { servableSourceSql } from "../corpus/integrity";
import { env } from "../env";

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
  /** The law's own number as cited — "رقم 8" (Phase 2.1). */
  number?: string;
  /** The law's own year as cited — "لسنة 1996" (Phase 2.1). */
  year?: number;
  /** The folded tokens of the whole citation as written, in order — what stripLawNames removes. */
  span?: string[];
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
  "وتعديلاته", "وتعديلاتها", "الموقت", "لعام",
  // A name never runs into a time or circumstance word ("قانون الإيجار عند الإجابة …").
  "عند", "عندما", "لدي", "حين", "خلال", "بعد", "قبل", "دون", "بدون", "حتي", "منذ",
]);
// A "name" of only these words is not a law name ("قانون جديد", "نظام معين").
const GENERIC_NAMES = new Set(["جديد", "معين", "خاص", "عام", "اخر", "سابق", "لاحق", "ساري", "نافذ"]);

const MAX_NAME_WORDS = 4;

function tokens(text: string): { folded: string; raw: string }[] {
  // Diacritics and tatweel dropped (not split on: "المعدّل" is one word);
  // other punctuation → space; keep letters and digits.
  const raw = text
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  // foldForSearch drops a lone number (cleanText treats it as a page number): digits stay digits.
  return raw.map((r) => ({ raw: r, folded: /^\p{N}+$/u.test(r) ? normalizeDigits(r) : foldForSearch(r) }));
}

/** The first law the question names, or null. */
export function extractLawReference(question: string): LawReference | null {
  return extractAllLawReferences(question)[0] ?? null;
}

// Abbreviations of the core codes as lawyers write them in pleadings and
// judgments ("م 326 ق.ع"), keyed by their folded letters. Dotted forms only:
// two bare letters are too ambiguous to read as a law.
const LAW_ABBREVIATIONS: Record<string, string> = {
  "ق ع": "قانون العقوبات",
  "ق م": "القانون المدني",
  "ق م ا": "القانون المدني الأردني",
  "ق ا م م": "قانون أصول المحاكمات المدنية",
  "ا م م": "قانون أصول المحاكمات المدنية",
  "ق ا م ج": "قانون أصول المحاكمات الجزائية",
  "ا م ج": "قانون أصول المحاكمات الجزائية",
  "ق ب": "قانون البينات",
  "ق ت": "قانون التجارة",
};

/**
 * Replaces a dotted law abbreviation ("ق.ع", "ق.أ.م.م") with the law's name.
 * "500 ق.م" (a year, before Christ) is left alone; "م 256 ق.م" (an article of
 * the civil code) is not.
 */
export function expandLawAbbreviations(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(\p{L})((?:\s*\.\s*\p{L})+)\.?(?![\p{L}\p{N}])/gu, (m, first: string, rest: string, offset: number) => {
    const letters = [first, ...rest.split(".").map((x) => x.trim()).filter(Boolean)].map((l) => foldForSearch(l)).join(" ");
    const full = LAW_ABBREVIATIONS[letters];
    if (!full) return m;
    const before = normalizeDigits(text.slice(0, offset));
    const afterArticle = /(?:ماد[ةه]|(?<!\p{L})م)\s*[.(]?\s*\d+\s*\)?\s*$/u.test(before);
    if (letters === "ق م" && /\d\s*$/.test(before) && !afterArticle) return m;
    return ` ${full} `;
  });
}

// "القانون رقم 8 لسنة 1996", "قانون رقم 8", "للنظام رقم (2) لسنة 2099" — a kind
// word with any attached prefix, when a number follows.
const NUMBERED_KIND_RE = /^(?:[وف])?(?:[بلك])?(?:ال|ل)?(قانون|نظام|تعليمات)$/;
// Words that may sit between a law's name and its number ("قانون العمل الأردني رقم 8").
const NUMBER_QUALIFIERS = new Set(["الاردني", "الاردنيه", "المعدل", "المعدله", "النافذ", "الساري", "الحالي", "الموقت", "وتعديلاته", "وتعديلاتها"]);
const YEAR_WORDS = new Set(["لسنه", "سنه", "لعام", "عام"]);

/** "رقم 8 لسنة 1996" / "لسنة 1996" starting at `start` (qualifiers skipped): the number, the year, and where the phrase ends. */
function numberPhrase(toks: { folded: string }[], start: number): { number?: string; year?: number; end: number } | null {
  let k = start;
  while (k < toks.length && k - start < 3 && NUMBER_QUALIFIERS.has(toks[k].folded)) k++;
  const at = (i: number) => toks[i]?.folded ?? "";
  let number: string | undefined;
  if (at(k) === "رقم" && /^\d{1,4}$/.test(at(k + 1))) {
    number = String(Number(at(k + 1)));
    k += 2;
  }
  let year: number | undefined;
  if (YEAR_WORDS.has(at(k)) && /^\d{4}$/.test(at(k + 1))) {
    year = Number(at(k + 1));
    k += 2;
  }
  if (number === undefined && year === undefined) return null;
  return { number, year, end: k };
}

/** Every law the text names, in order of appearance (deduplicated by key). */
export function extractAllLawReferences(text: string): LawReference[] {
  const found: LawReference[] = [];
  const push = (r: LawReference) => {
    const same = found.find((f) => f.key === r.key && f.number === r.number && f.year === r.year);
    if (!same) found.push(r);
  };
  const toks = tokens(expandLawAbbreviations(text));
  // A name reference absorbs a number phrase right after it ("قانون العمل رقم 8 لسنة 1996").
  const withNumber = (r: LawReference, from: number, spanStart: number): LawReference => {
    const np = numberPhrase(toks, from);
    const end = np ? np.end : from;
    return {
      ...r,
      ...(np?.number !== undefined ? { number: np.number } : {}),
      ...(np?.year !== undefined ? { year: np.year } : {}),
      span: toks.slice(spanStart, end).map((t) => t.folded),
    };
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].folded;

    // "القانون المدني" — definite form (with an optional و/ف/ب/ل prefix) + a known adjective.
    if (DEFINITE_LAW_FORMS.has(t) && i + 1 < toks.length && DEFINITE_LAW_ADJECTIVES.has(toks[i + 1].folded)) {
      push(withNumber({ key: `القانون ${toks[i + 1].folded}`, display: `${toks[i].raw} ${toks[i + 1].raw}` }, i + 2, i));
      continue;
    }
    if (t === "الدستور" || t === "للدستور" || t === "بالدستور") {
      push({ key: "الدستور", display: "الدستور", span: [t] });
      continue;
    }

    // "القانون رقم 8 لسنة 1996" — a law cited by its number (and year) alone.
    const numbered = t.match(NUMBERED_KIND_RE);
    if (numbered && toks[i + 1]?.folded === "رقم") {
      const np = numberPhrase(toks, i + 1);
      if (np?.number !== undefined) {
        const kindWord = numbered[1];
        push({
          key: `${kindWord} رقم ${np.number}${np.year !== undefined ? ` لسنه ${np.year}` : ""}`,
          display: toks.slice(i, np.end).map((x) => x.raw).join(" "),
          kind: kindWord,
          number: np.number,
          ...(np.year !== undefined ? { year: np.year } : {}),
          span: toks.slice(i, np.end).map((x) => x.folded),
        });
        i = np.end - 1;
        continue;
      }
    }

    const kind = t.match(KIND_RE);
    if (!kind) continue;
    // "تعليمات نظام …" / "نظام قانون …" are not law names (the first is how an
    // injection says "system instructions").
    if (i + 1 < toks.length && KIND_RE.test(toks[i + 1].folded)) continue;
    if (i > 0 && KIND_RE.test(toks[i - 1].folded)) continue;
    const name: { folded: string; raw: string }[] = [];
    let j = i + 1;
    for (; j < toks.length && name.length < MAX_NAME_WORDS; j++) {
      const w = toks[j];
      if (STOP.has(w.folded) || /\d/.test(w.folded)) break;
      name.push(w);
    }
    if (name.length === 0 || name.every((w) => GENERIC_NAMES.has(w.folded))) continue;
    push(
      withNumber(
        {
          key: `${kind[1]} ${name.map((w) => w.folded).join(" ")}`,
          display: `${kind[1]} ${name.map((w) => w.raw).join(" ")}`,
          nameWords: name.map((w) => w.folded),
          kind: kind[1],
        },
        i + 1 + name.length,
        i
      )
    );
  }
  return found;
}

/** A reference that names no law, only a number (and year): "القانون رقم 8 لسنة 1996". */
function isNumberOnly(ref: LawReference): boolean {
  return !ref.nameWords && ref.number !== undefined && /^(?:قانون|نظام|تعليمات) رقم /.test(ref.key);
}

/** "… رقم 8 لسنة 1996" in a folded title: its kind, number and year. */
export function titleCitation(folded: string): { kind: string | null; number?: string; year?: number } {
  const kind = folded.match(/^(?:ال)?(قانون|نظام|تعليمات)(?:\s|$)/)?.[1] ?? null;
  const n = folded.match(/رقم\s*\(?\s*(\d{1,4})(?!\d)/);
  const y = folded.match(/(?:لسنه|سنه|لعام|عام)\s*\(?\s*(\d{4})(?!\d)/);
  return { kind, ...(n ? { number: String(Number(n[1])) } : {}), ...(y ? { year: Number(y[1]) } : {}) };
}

/** Whether the number and year a reference cites (those it cites) are the title's. */
function citationMatches(ref: LawReference, folded: string): boolean {
  const c = titleCitation(folded);
  if (ref.number !== undefined && c.number !== ref.number) return false;
  if (ref.year !== undefined && c.year !== ref.year) return false;
  return true;
}

export type LawResolution = {
  ref: LawReference;
  sourceIds: number[];
  /** The cited number/year picked out a specific version of the named law (Phase 2.1). */
  pinned?: boolean;
  /** Whether a pinned version is the one in force (false: the lawyer cited a superseded text). */
  pinnedCurrent?: boolean;
  /** The law was found by name, but not under the number/year the question cites. */
  citationMismatch?: boolean;
  /** A number with no year matched several laws — not treated as naming any one of them. */
  ambiguous?: boolean;
};

/**
 * Resolves a reference against corpus titles, tolerating trailing words the
 * extractor could not tell apart from the name ("قانون العمل التجريبي قبل
 * التعديل", "قانون العقوبات تعاقب بالإعدام"): the longest prefix of the name
 * that matches a title wins. A prefix never drops below two name words when
 * the name has two or more — "قانون حماية المستهلك" must not fall back to
 * "قانون حماية" and match "قانون حماية البيئة".
 *
 * Phase 2.1: a law cited by number and year alone ("القانون رقم 8 لسنة 1996")
 * resolves by its title's number and year; a named law cited WITH its number
 * or year is pinned to the version that carries them (when one does).
 */
export function resolveAgainstTitles(ref: LawReference, titles: SourceTitle[]): LawResolution {
  if (isNumberOnly(ref)) {
    const hits = titles.filter((t) => titleCitation(t.folded).kind === ref.kind && citationMatches(ref, t.folded));
    // "القانون رقم 8" with no year: several laws of different years carry that number.
    const distinctYears = new Set(hits.map((t) => titleCitation(t.folded).year ?? null));
    if (ref.year === undefined && distinctYears.size > 1) return { ref, sourceIds: [], ambiguous: true };
    return { ref, sourceIds: hits.map((t) => t.id) };
  }
  const byName = resolveByName(ref, titles);
  if ((ref.number === undefined && ref.year === undefined) || byName.sourceIds.length === 0) return byName;
  const pinned = titles.filter((t) => byName.sourceIds.includes(t.id) && citationMatches(ref, t.folded));
  if (pinned.length === 0) return { ...byName, citationMismatch: true };
  return { ...byName, sourceIds: pinned.map((t) => t.id), pinned: true, pinnedCurrent: pinned.some((t) => t.current !== false) };
}

function resolveByName(ref: LawReference, titles: SourceTitle[]): LawResolution {
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
  const folded = source.title ? foldForSearch(source.title) : null;
  // Cited by number (and year): the source's title must carry them. A named
  // law cited with its number must not be matched to another version's text,
  // except through an amending act (whose title carries its own number).
  if (isNumberOnly(ref)) return !!folded && titleCitation(folded).kind === ref.kind && citationMatches(ref, folded);
  if ((ref.number !== undefined || ref.year !== undefined) && folded && !AMENDING_RE.test(folded)) {
    const c = titleCitation(folded);
    if ((c.number !== undefined || c.year !== undefined) && !citationMatches(ref, folded)) return false;
  }
  const bare = ref.key.replace(/^ال/, "");
  if (source.lawName) {
    const ln = foldForSearch(source.lawName);
    if (new RegExp(`^(?:ال)?${escapeRe(bare)}(\\s|$)`).test(ln)) return true;
  }
  if (folded && matchLawTitles(ref, [{ id: 0, folded }]).length > 0) return true;
  return false;
}

const AMENDING_RE = /^(?:قانون|نظام|تعليمات)\s+معد[ّ]?ل\s/;

// ---- matching against the corpus --------------------------------------------

type SourceTitle = { id: number; folded: string; current?: boolean };
type HeldBackTitle = SourceTitle & { integrity: string };
let titleCache: { at: number; rows: SourceTitle[]; heldBack: HeldBackTitle[] } | null = null;
// legal_sources is small (hundreds of rows); folding every title in JS with
// the exact function the question was folded with is both simpler and more
// faithful than re-implementing foldForSearch in SQL. A new source becomes
// matchable within TITLE_TTL_MS.
const TITLE_TTL_MS = 5 * 60_000;

async function loadTitles(): Promise<{ rows: SourceTitle[]; heldBack: HeldBackTitle[] }> {
  if (titleCache && Date.now() - titleCache.at < TITLE_TTL_MS) return titleCache;
  const rows = await query<{ id: string | number; title: string; is_current_version: boolean; integrity_status: string; servable: boolean }>(
    // Ready Jordanian sources (fixtures only when allowed). Only the ones
    // retrieval may serve make a law "present"; the rest — unchecked,
    // quarantined, replaced — are kept apart so a question naming such a law
    // is told it is held back, not that it does not exist (corpus repair).
    `SELECT id, title, is_current_version, integrity_status, (${servableSourceSql("", "$1")}) AS servable
       FROM legal_sources
      WHERE status = 'ready' AND jurisdiction = 'JO' AND (is_synthetic = false OR $1::boolean)`,
    [env.allowSyntheticCorpus]
  );
  const shape = (r: (typeof rows)[number]) => ({ id: Number(r.id), folded: foldForSearch(r.title), current: r.is_current_version });
  titleCache = {
    at: Date.now(),
    rows: rows.filter((r) => r.servable).map(shape),
    heldBack: rows.filter((r) => !r.servable).map((r) => ({ ...shape(r), integrity: r.integrity_status })),
  };
  return titleCache;
}

async function sourceTitles(): Promise<SourceTitle[]> {
  return (await loadTitles()).rows;
}

/**
 * A named law with no servable source that IS in the database, held back
 * because its text has not passed the integrity checks (unchecked,
 * quarantined, or replaced with no servable replacement). The answer must say
 * so — "not in the corpus" would be untrue, and quoting it is not allowed.
 */
export async function heldBackLaw(ref: LawReference): Promise<{ display: string; statuses: string[] } | null> {
  const { heldBack } = await loadTitles();
  const r = resolveAgainstTitles(ref, heldBack);
  if (r.sourceIds.length === 0) return null;
  const statuses = [...new Set(heldBack.filter((t) => r.sourceIds.includes(t.id)).map((t) => t.integrity))].sort();
  return { display: ref.display, statuses };
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

export async function resolveLawReference(ref: LawReference): Promise<LawResolution> {
  return resolveAgainstTitles(ref, await sourceTitles());
}
