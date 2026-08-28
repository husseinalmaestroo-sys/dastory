import "server-only";

/**
 * Detects mojibake in text extracted from Arabic PDFs.
 *
 * Why this exists: Jordanian Official Gazette PDFs — and Arabic PDFs generally
 * — routinely embed subsetted fonts with a broken or absent ToUnicode CMap.
 * The page renders perfectly in any viewer, but the text layer maps glyphs to
 * the wrong codepoints, so extraction yields fluent-looking garbage:
 *
 *     اٌّبصح 3 - ٠ـّٝ ٘ظا اٌمابْٔٛ      ("المادة 1 - يسمى هذا القانون")
 *
 * A density check cannot catch this — the garbage is dense. Only the content
 * gives it away: the substitution destroys every real word, so the function
 * words that appear in every Arabic sentence vanish entirely. Real Arabic
 * prose cannot avoid في / من / على. Mojibake cannot produce them.
 */

// High-frequency Arabic function words. Deliberately generic — no legal terms.
// A law, a contract and a news article all contain these; a broken encoding
// contains none of them.
const COMMON_WORDS = new Set([
  "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "ذلك", "التي",
  "الذي", "أن", "ان", "إن", "أو", "او", "لا", "ما", "كل", "بعد", "قبل", "عند",
  "بين", "هو", "هي", "قد", "كان", "كانت", "يكون", "تكون", "به", "له", "لها",
  "عليه", "عليها", "فيه", "فيها", "منها", "وفي", "ومن", "وعلى",
]);

const ARABIC_CHAR = /[؀-ۿ]/;
const ARABIC_RANGE_G = /[^؀-ۿ]+/;
/** Diacritics (U+064B–U+0670) plus tatweel (U+0640). */
const DIACRITICS_AND_TATWEEL = /[ً-ٰـ]/g;

export type TextQuality = {
  /** Share of non-space characters that are Arabic. */
  arabicRatio: number;
  /** How many *distinct* common words appear at least once. The real signal. */
  distinctCommonWords: number;
  /** Common-word hits per 1000 Arabic chars. Diagnostics only — see below. */
  commonWordRate: number;
  /**
   * Share of Arabic tokens that are a single orphaned letter. Catches PARTIAL
   * corruption, which the common-word check cannot — see below.
   */
  orphanLetterRatio: number;
  /** True when the text is meant to be Arabic but the encoding is broken. */
  garbled: boolean;
  reason: string | null;
};

/**
 * Vocabulary coverage, not density, decides this.
 *
 * The first cut of this file used hits-per-1000-chars and produced a false
 * positive on a real file: a 2-page amending law whose text was perfectly
 * clean scored 3.8 against a threshold of 4, because a short document padded
 * with formal preamble has a low *density* of function words no matter how
 * intact it is. Density measures document style; we need to measure encoding.
 *
 * Coverage does that. "Do real Arabic words appear at all?" is independent of
 * document length and of how verbose the boilerplate is.
 *
 * Measured over all 24 laws from moj.gov.jo (deploy/sources/moj-laws-ar.txt):
 *
 *   garbled files (4)  : 1, 1, 3, 3          distinct common words
 *   clean files  (20)  : 7, 14, 18, 20 … 42
 *
 * So the observed gap is 3 → 7 and the threshold sits in it. That is a real
 * separation but a narrower one than it looks: the 7 is a 2-page amending law,
 * the shortest clean document in the set. A one-page notice could plausibly
 * score lower and be OCR'd needlessly — which costs ~6s/page and withholds its
 * article numbers. Acceptable, and the right direction to err: a false "fine"
 * verdict puts unsearchable mojibake in the index permanently.
 *
 * If short clean files start getting OCR'd, widen COMMON_WORDS before lowering
 * this — more vocabulary raises the floor for real text without helping a
 * broken font map, which cannot produce "في" AND "من" AND "على" by accident.
 */
const MIN_DISTINCT_COMMON_WORDS = 5;

/**
 * The second signal: PARTIAL corruption, which the common-word check misses.
 *
 * The check above catches a total substitution cipher — every real word is
 * destroyed, so no function word survives. But a broken ToUnicode map often
 * corrupts only *some* glyphs, and then the high-frequency words survive while
 * the rest of the text is shredded. That file passes the vocabulary check and
 * lands in the index looking fine. Three real examples, all from moj.gov.jo,
 * all previously ingested with a clean bill of health:
 *
 *   قانون العقوبات   "ف جريمة إف بنص وف يقضه بأ"      ← "لا جريمة إلا بنص ولا يقضى بأي"
 *   قانون التنفيذ    "ةملاااس وا تااالجم وا ةااامكحم"  ← reversed runs + tatweel padding
 *   القانون المدني   "قرر الن الجديود مودة لاتقوادم"   ← "قرر النص الجديد مدة للتقادم"
 *
 * What they share is shredding words into loose letters: "عليهما" becomes
 * "ع يهما", "ولا" becomes "و ف". Clean Arabic almost never leaves a letter
 * standing alone — its one-letter particles (و، ب، ل، ك) are written attached
 * to the following word, so a lone letter is an artefact, not orthography.
 *
 * Measured over the corpus with this file's own tokeniser:
 *
 *   clean   : 1.0  2.2  2.6  2.7  4.1   %   (البينات، أصول المحاكمات، التجارة، العمل، الشركات)
 *   corrupt : 6.1  11.8  16.3          %   (المدني، التنفيذ، العقوبات)
 *
 * The gap is 4.1 → 6.1 and the threshold sits in it. Narrower than the
 * vocabulary check's margin, so it is deliberately set to err toward flagging:
 * a false positive costs one OCR pass, while a false "fine" puts a shredded
 * statute in front of a lawyer permanently — which is exactly what happened to
 * these three.
 *
 * Legal clause markers (أ- ب- ج-) DO tokenise as orphans and are why the clean
 * files sit at 2-4% rather than 0. That is already priced into the threshold.
 *
 * KNOWN LIMIT — read before trusting a "clean" verdict:
 * this signal measures SPLITTING. العقوبات (16.3%) and التنفيذ (11.8%) shred
 * words into loose letters and are caught with room to spare. المدني corrupts
 * by SUBSTITUTION instead ("الجديد" → "الجديود") — the word stays one token, so
 * it only reaches 6.1% and clears the bar by 1.1 points. A substitution-only
 * file that is shorter, or slightly less damaged, will pass. Catching that
 * class needs a dictionary or a language model, not a shape heuristic; until
 * then, spot-check the first chunks of any newly ingested law by eye.
 */
const MAX_ORPHAN_LETTER_RATIO = 0.05;

/** Below this Arabic share, the text isn't Arabic and this check doesn't apply. */
const MIN_ARABIC_RATIO = 0.25;

/** Too little text to judge — a caption may legitimately lack these words. */
const MIN_ARABIC_CHARS = 300;

export function assessArabicText(text: string): TextQuality {
  const nonSpace = text.replace(/\s/g, "");
  const arabicChars = [...nonSpace].filter((c) => ARABIC_CHAR.test(c)).length;
  const arabicRatio = nonSpace.length > 0 ? arabicChars / nonSpace.length : 0;

  // Strip diacritics and tatweel before tokenising. Tatweel matters more than
  // it looks: Gazette PDFs justify text by stretching words ("علــــى"), and
  // without this every stretched word would miss the vocabulary list.
  const tokens = text.replace(DIACRITICS_AND_TATWEEL, "").split(ARABIC_RANGE_G).filter(Boolean);

  const present = new Set<string>();
  let hits = 0;
  for (const t of tokens) {
    if (COMMON_WORDS.has(t)) {
      present.add(t);
      hits++;
    }
  }

  const distinctCommonWords = present.size;
  const commonWordRate = arabicChars > 0 ? (hits / arabicChars) * 1000 : 0;
  const orphanLetterRatio = tokens.length > 0 ? tokens.filter((t) => t.length === 1).length / tokens.length : 0;
  const base = { arabicRatio, distinctCommonWords, commonWordRate, orphanLetterRatio };

  if (arabicChars < MIN_ARABIC_CHARS) return { ...base, garbled: false, reason: null };

  // Mostly Latin — an English translation, say. Not this check's business.
  if (arabicRatio < MIN_ARABIC_RATIO) return { ...base, garbled: false, reason: null };

  if (distinctCommonWords < MIN_DISTINCT_COMMON_WORDS) {
    return {
      ...base,
      garbled: true,
      reason:
        `Arabic-script text containing only ${distinctCommonWords} distinct common Arabic word(s) ` +
        `(expected at least ${MIN_DISTINCT_COMMON_WORDS}). ` +
        `The PDF's font encoding is broken — its text layer cannot be trusted.`,
    };
  }

  // Partial corruption: the common words survived, but the text around them is
  // shredded into loose letters.
  if (orphanLetterRatio > MAX_ORPHAN_LETTER_RATIO) {
    return {
      ...base,
      garbled: true,
      reason:
        `${(orphanLetterRatio * 100).toFixed(1)}% of Arabic tokens are single orphaned letters ` +
        `(expected at most ${(MAX_ORPHAN_LETTER_RATIO * 100).toFixed(0)}%). ` +
        `The PDF's font encoding is partially broken: common words survive but the text ` +
        `between them is shredded, so article wording cannot be trusted.`,
    };
  }

  return { ...base, garbled: false, reason: null };
}
