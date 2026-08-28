import "server-only";

/**
 * Conservative Arabic light stemmer for the keyword-search arm.
 *
 * WHY THIS EXISTS
 *
 * Postgres has no Arabic stemming config — db/schema.sql's `content_tsv` is
 * built with `to_tsvector('simple', ...)`, which tokenises on whitespace and
 * does NOT fold "المستأجر" / "مستأجرين" / "وللمستأجر" to a shared token (the
 * schema comment says so explicitly). A lawyer searching "مستأجر" gets an
 * exact hit on that surface form and misses every plural/prefixed occurrence
 * of the same legal noun elsewhere in the corpus.
 *
 * WHAT THIS IS NOT
 *
 * This is NOT root extraction (Khoja-style, reducing a word to a 3-letter
 * root). Root stemmers routinely collapse unrelated words onto the same root
 * (مكتب/كتاب/كاتب all pull toward ك-ت-ب) — exactly the false-match risk a
 * legal search cannot afford. This strips only the clitics that Arabic
 * orthography glues onto a word — the definite article and a
 * preposition-plus-article compound on the front, the feminine ة marker and
 * pronoun/plural suffixes on the back — leaving the derivational stem itself
 * untouched: "المستأجرين" → "مستأجر", never → "أجر".
 *
 * TAKES TEXT BEFORE foldForSearch'S ة→ه FOLD, ON PURPOSE. ة (ta marbuta) is
 * almost never a root letter — stripping it is safe and high-value, since it
 * is the single most common noun ending in the corpus (شركة، محكمة، ضريبة،
 * تجارة …). But once folded to ه it becomes indistinguishable from a genuine
 * attached pronoun "ه" ("his/its"), and a legal statute's root nouns
 * frequently end in ه/ي/ك as real root letters, not pronouns — "المستهلك"
 * (consumer) ends in the root letter ك. Stripping ة first, then folding the
 * REST the same way foldForSearch does (أ/إ/آ/ٱ→ا, ى→ي, ؤ→و, ئ→ي), then never
 * stripping bare ه/ي/ك as suffixes at all, is what keeps "الشركة"/"شركات"
 * colliding on one stem while leaving "المستهلك" alone. Callers therefore
 * pass `cleanText`-normalised (not `foldForSearch`-folded) text in; this
 * module does its own folding internally, after the ة-strip.
 *
 * PREFIX LIST INCLUDES BARE و/ف/ب/ك/ل (the standard "Light-10" Arabic-IR
 * stemmer set, Larkey & Connell). These occasionally over-strip a word whose
 * first radical happens to be one of those letters ("كتاب" → "تاب"), and a
 * few coincidental suffix collisions exist too ("المحاكم" → "محا", the "كم"
 * rule mistaking a plural's trailing letters for the 2nd-person-plural
 * pronoun). Accepted deliberately: this is a SUPPLEMENTARY ranking arm fused
 * by RRF alongside the exact keyword and vector arms, not a replacement for
 * either, so an occasional bad stem is diluted noise, not a wrong answer —
 * and the net effect is what scripts/benchmark.ts measures before this ships.
 *
 * Runs at ingest time (stemmed_text column, search/hybrid.ts's stem arm) and
 * at query time (building the stemmed tsquery) — never touches embeddings,
 * which stay computed on the verbatim, unfolded chunk text.
 */

// Longest-first, and exactly one is stripped per pass: matching "وبال" before
// "وال" (and "وال" before bare "و") stops a shorter prefix from being tried
// again on what a longer, more specific match would have left behind.
const PREFIXES = ["وبال", "فبال", "وكال", "فكال", "وال", "بال", "كال", "فال", "لل", "ال", "و", "ف", "ب", "ك", "ل"];

// Longest-first for the same reason — "هما" before "ها" so a dual pronoun
// isn't read as the feminine-plural marker leaving a stray "ما". No bare
// ه/ي/ك here: see the module comment on why those stay unstripped.
const SUFFIXES = ["يهما", "كما", "هما", "هن", "هم", "كن", "كم", "تن", "تم", "نا", "وا", "ين", "ون", "ات", "ان", "ها"];

// A stem shorter than this is not a stem, it is noise — most Arabic roots are
// themselves 3 letters, so guard against stripping a word down to nothing
// meaningful.
const MIN_STEM_LEN = 2;

// Arabic clitics stack at most 2-3 deep in real usage (و + ل/ب/ك + ال —
// "وللمستأجر" = و + لل + مستأجر, "and for the tenant"). One stripping pass
// only catches the outermost layer and leaves "للمستأجر" un-normalised
// against the bare "المستأجر" it should collide with. Two passes catches
// that without unbounded stripping — MIN_STEM_LEN still guards every pass.
const MAX_PREFIX_PASSES = 2;

const ARABIC_WORD_RE = /^[؀-ۿ]+$/;

/** Same orthographic folding as ingest/clean.ts's foldForSearch, minus ة→ه — that one is handled separately, before this, so it stays distinguishable from a genuine attached pronoun. */
function foldExceptTaMarbuta(word: string): string {
  return word.replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
}

/**
 * Strips a trailing ة, up to two layered prefixes, and one suffix from a
 * single word.
 *
 * @param word Arabic word BEFORE foldForSearch's ة→ه fold (cleanText output,
 *   or raw — diacritics/tatweel do not need to be gone, just ة intact).
 */
export function stemArabicWord(word: string): string {
  // Below this length the word almost certainly IS its own root (or is a
  // function word too short to carry a clitic worth stripping).
  if (word.length <= 3) return word;

  // ة first, while it is still distinguishable from a pronoun ه.
  let w = word.endsWith("ة") && word.length - 1 >= MIN_STEM_LEN ? word.slice(0, -1) : word;
  w = foldExceptTaMarbuta(w);

  for (let pass = 0; pass < MAX_PREFIX_PASSES; pass++) {
    let stripped = false;
    for (const p of PREFIXES) {
      if (w.startsWith(p) && w.length - p.length >= MIN_STEM_LEN) {
        w = w.slice(p.length);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= MIN_STEM_LEN) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

/**
 * Stems every Arabic word in text, space-joined. Digits, Latin runs and
 * stray punctuation pass through unchanged — this only ever touches
 * Arabic-letter tokens.
 *
 * @param text `cleanText`-normalised text — NOT `foldForSearch`-folded (see
 *   module comment: this function needs ة intact and does its own folding).
 */
export function stemArabicText(text: string): string {
  return text
    .split(/\s+/)
    .map((raw) => {
      // Strip attached punctuation ("(قانون", "القانون،") before testing —
      // otherwise a word glued to a paren/comma with no space silently skips
      // stemming, which is exactly the kind of PDF-formatting artifact this
      // corpus has plenty of (see ingest/clean.ts's own line-rejoin logic).
      const w = raw.replace(/^[^؀-ۿ]+|[^؀-ۿ]+$/g, "");
      if (!w) return raw;
      return ARABIC_WORD_RE.test(w) ? stemArabicWord(w) : raw;
    })
    .filter(Boolean)
    .join(" ");
}
