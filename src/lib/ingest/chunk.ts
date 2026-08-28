import "server-only";
import { normalizeDigits } from "./clean";
import { extractLegalTopics } from "./legal-topics";

export type LegalChunk = {
  text: string;
  articleNumber: string | null;
  /** الباب — top structural division the article sits under. */
  part: string | null;
  /** الفصل — chapter within the part. */
  chapter: string | null;
  /** الفرع / القسم / المبحث — sub-division within the chapter. */
  section: string | null;
  keywords: string[];
  /** المواضيع القانونية — curated legal subject tags. */
  legalTopics: string[];
  /**
   * For court decisions only: which structural part of the ruling this chunk
   * is — الوقائع / الأسباب / المبدأ / المنطوق (or أخرى). Null for legislation.
   */
  decisionSection: string | null;
  /**
   * For a المبدأ (principle) chunk: the index of the chunk that establishes it
   * — the reasoning (الأسباب), else the operative part (المنطوق). This is a
   * within-document link by chunk position, and chunk_index is stored, so the
   * "principle ↔ the text that proves it" relation survives into the database.
   */
  provesChunkIndex: number | null;
};

// ~1200 chars ≈ 400 Arabic tokens. Big enough to hold a whole article with its
// clauses, small enough that eight of them still leave the context window
// mostly empty — which is the entire point of retrieving instead of stuffing.
const TARGET_CHARS = 1200;
const MAX_CHARS = 1800;
const OVERLAP_CHARS = 150;

// "المادة 5" / "مادة (5)" / "المادة 5 مكرر" at the start of a line.
const ARTICLE_RE = /^\s*(?:ال)?مادة\s*[({\[]?\s*(\d+(?:\s*(?:مكرر|مكررا|مكرراً))?(?:\s*[/\-]\s*\w+)?)\s*[)}\]]?\s*[:.\-]?/;

// Decision headers, for splitting a court ruling into its structural parts.
const SECTION_RE = /^\s*(?:الوقائع|الأسباب|أسباب الحكم|المنطوق|لهذه الأسباب|الحكم|القرار|المبدأ|الطلبات|الإجراءات)\s*[:.]?\s*$/;

const EMPTY = {
  part: null,
  chapter: null,
  section: null,
  decisionSection: null,
  provesChunkIndex: null,
} as const;

/**
 * Splits legal text into retrieval chunks.
 *
 * The unit of legal meaning is the article, not the paragraph — a lawyer cites
 * "المادة 202", and half an article is a wrong answer. So we cut on article
 * boundaries first and only fall back to sliding windows for prose that has no
 * article structure (court decisions, memos).
 *
 * Beyond the article number, each chunk carries the structural context it sits
 * in — the الباب/الفصل/الفرع headings above it — so a retrieved article knows
 * "الباب الثاني: الجرائم الواقعة على الأموال / الفصل الأول: السرقة" even though
 * those words appear paragraphs earlier and would never be in the chunk itself.
 * That context is what lets the model read an isolated article correctly.
 */
export function chunkLegalText(text: string, opts?: { sourceType?: string }): LegalChunk[] {
  const lines = text.split("\n");
  const hasArticles = lines.some((l) => ARTICLE_RE.test(l));

  const chunks = hasArticles ? chunkByArticle(lines) : chunkByWindow(text, opts?.sourceType);

  const enriched = chunks
    .filter((c) => c.text.trim().length >= 40) // drop headers/artifacts
    .map((c) => ({
      ...c,
      text: c.text.trim(),
      keywords: extractKeywords(c.text),
      legalTopics: extractLegalTopics(c.text),
    }));

  // Link each principle to the reasoning that proves it. Done after filtering
  // so the indices it stores are the final chunk positions (== chunk_index).
  return linkPrinciplesToProof(enriched);
}

// ------------------------------------------------------------------ structure

type Kind = "part" | "chapter" | "section";
type Marker = { kind: Kind; designation: string; hadTitle: boolean };

// Keyword → structural level. الكتاب folds into the part level (only the big
// codes use it). المبحث sits with الفرع/القسم at section level.
const STRUCT_WORDS = ["الكتاب", "الباب", "الفصل", "الفرع", "القسم", "المبحث"];
function kindOf(word: string): Kind {
  if (word === "الكتاب" || word === "الباب") return "part";
  if (word === "الفصل") return "chapter";
  return "section";
}

// A strict ordinal — a known ordinal word (with optional عشر / tens tail) or a
// number. Strict on purpose: `ال\w+` would match ordinary title words like
// "الاعمال" and mistake them for the ordinal after "الباب".
const ORD =
  "(?:ال(?:أ|ا)ول[ىي]?|الثاني[ةه]?|الثالث[ةه]?|الرابع[ةه]?|الخامس[ةه]?|السادس[ةه]?|السابع[ةه]?|الثامن[ةه]?|التاسع[ةه]?|العاشر[ةه]?|الحادي[ةه]?|العشر[وي]ن|الثلاث[وي]ن|الاربع[وي]ن)(?:\\s+(?:عشر[ةه]?|والعشر[وي]ن|والثلاث[وي]ن))?|\\(?\\d{1,3}\\)?";
const ORD_RE = new RegExp(`^(?:${ORD})$`);
const STRUCT_LEAD_RE = new RegExp(`^(${STRUCT_WORDS.join("|")})\\s+(${ORD})\\b`);

// Words that open an article's body, not a heading title — a title never leads
// with a verb. Prepositions (من/في/على) are deliberately NOT here: real chapter
// titles contain them ("التجار على وجه عام"), and a prose body is rejected
// later anyway because it leaves a non-clause remainder.
const BODY_OPENERS = new Set([
  "تعد","يعد","يسمى","يجب","تجب","يكون","تكون","تطبق","يطبق","فتطبق","يعاقب","تعاقب",
  "يحظر","يحق","يلتزم","يلزم","يقع","تقع","يعتبر","تعتبر","ينشأ","ينشا","لا","اذا","إذا","ان","أن",
]);

const isClauseStart = (s: string) => /^\(?\d+\)?\s*[-.،]/.test(s.trim());

/**
 * Captures a heading's title — the words after the ordinal — stopping at the
 * next structural marker, a body-opener verb, a numbered clause, or 8 words.
 */
function captureTitle(words: string[], start: number): { title: string; next: number } {
  const title: string[] = [];
  let i = start;
  for (; i < words.length; i++) {
    const w = words[i];
    if (STRUCT_WORDS.includes(w) && i + 1 < words.length && ORD_RE.test(words[i + 1])) break;
    if (/^\(?\d+\)?[-.،]?$/.test(w)) break;
    if (BODY_OPENERS.has(w)) break;
    if (title.length >= 8) break;
    title.push(w);
  }
  return { title: title.join(" "), next: i };
}

/**
 * Pulls a run of leading structural markers off a line. Jordanian statutes from
 * the official source glue the headings onto the article line —
 * "المادة 6 الباب الثاني الاعمال التجارية", or several at once
 * "المادة 1 الكتاب الاول ... الباب الاول احكام عامة". Returns each marker (with
 * its title folded into the designation) and whatever body text remains.
 */
function stripLeadingStructure(rest: string): { markers: Marker[]; body: string } {
  const markers: Marker[] = [];
  let words = rest.trim().split(/\s+/).filter(Boolean);

  for (;;) {
    if (words.length < 2 || !STRUCT_WORDS.includes(words[0]) || !ORD_RE.test(words[1])) break;
    const keyword = words[0];
    const ordinal = words[1];
    const { title, next } = captureTitle(words, 2);
    const designation = title ? `${keyword} ${ordinal} - ${title}` : `${keyword} ${ordinal}`;
    markers.push({ kind: kindOf(keyword), designation: designation.replace(/\s+/g, " ").trim(), hadTitle: !!title });
    words = words.slice(next);
  }

  return { markers, body: words.join(" ").trim() };
}

function chunkByArticle(lines: string[]): LegalChunk[] {
  const out: LegalChunk[] = [];
  let buf: string[] = [];
  let current: string | null = null;
  // Live structural context, updated as markers pass by.
  let part: string | null = null;
  let chapter: string | null = null;
  let section: string | null = null;
  // A bare heading ("الفصل الأول") whose title is on the following line.
  let pendingTitle: Kind | null = null;

  const flush = () => {
    const text = buf.join("\n").trim();
    if (!text) return;

    // A single article can still run past the window (long procedural
    // articles). Split it, but stamp every piece with the same article number
    // AND the same structural context so neither the citation nor its place in
    // the law is lost across the split.
    if (text.length > MAX_CHARS) {
      for (const piece of slidingWindow(text)) out.push(mk(piece, current, part, chapter, section));
    } else {
      out.push(mk(text, current, part, chapter, section));
    }
    buf = [];
  };

  const apply = (m: Marker) => {
    if (m.kind === "part") {
      part = m.designation;
      chapter = null;
      section = null;
    } else if (m.kind === "chapter") {
      chapter = m.designation;
      section = null;
    } else {
      section = m.designation;
    }
  };

  const setTitle = (kind: Kind, title: string) => {
    const t = title.slice(0, 60).trim();
    if (kind === "part" && part) part = `${part} - ${t}`;
    else if (kind === "chapter" && chapter) chapter = `${chapter} - ${t}`;
    else if (kind === "section" && section) section = `${section} - ${t}`;
  };

  // Markers are real structure only when what's left after them is not article
  // prose — i.e. nothing, or a numbered clause. A remainder that is a sentence
  // ("... من العقد يعتبر باطلاً") means the line was prose that merely began
  // with "الفصل الأول", so the structure parse is discarded and the line kept
  // whole. This is what separates a heading from a subject-of-a-sentence.
  const structureIsReal = (markers: Marker[], body: string) =>
    markers.length > 0 && (body === "" || isClauseStart(body));

  for (const line of lines) {
    const am = line.match(ARTICLE_RE);

    if (am) {
      const num = normalizeDigits(am[1]).replace(/\s+/g, " ").trim();
      const rest = line.slice(am[0].length).trim();
      const { markers, body } = stripLeadingStructure(rest);

      flush();
      pendingTitle = null;
      current = num;

      if (structureIsReal(markers, body)) {
        markers.forEach(apply);
        // Heading-only line → article body arrives on the next المادة line.
        // Heading + numbered clause → keep the clause as the article's start.
        if (body) buf.push(`المادة ${num} ${body}`);
      } else {
        // Ordinary article (no markers, or a prose line beginning with a
        // structural word) — keep it verbatim.
        buf.push(line);
      }
      continue;
    }

    // Bare structural heading on its own line (moj.gov.jo formatting).
    const { markers, body } = stripLeadingStructure(line.trim());
    if (structureIsReal(markers, body)) {
      flush();
      markers.forEach(apply);
      const last = markers[markers.length - 1];
      pendingTitle = last.hadTitle ? null : last.kind;
      if (body) buf.push(body);
      continue;
    }

    if (!line.trim()) {
      buf.push(line);
      continue;
    }

    if (pendingTitle) {
      setTitle(pendingTitle, line.trim());
      pendingTitle = null;
      continue; // the title is metadata, not article body
    }

    buf.push(line);
  }
  flush();

  return out;
}

function chunkByWindow(text: string, sourceType?: string): LegalChunk[] {
  // Court decisions have their own skeleton (الوقائع / الأسباب / المبدأ /
  // المنطوق). Cutting on it keeps "لهذه الأسباب" whole — the part that matters —
  // and lets each chunk be tagged with which part of the ruling it is.
  if (sourceType === "court_decision") {
    const parts = splitDecisionSections(text);
    if (parts.length > 1) {
      return parts.flatMap((p) =>
        p.text.length > MAX_CHARS
          ? slidingWindow(p.text).map((t) => ({ ...blank(), text: t, decisionSection: p.section }))
          : [{ ...blank(), text: p.text, decisionSection: p.section }]
      );
    }
  }
  return slidingWindow(text).map((t) => ({ ...blank(), text: t }));
}

/** Canonicalises a decision header line to one of the four ruling parts. */
function canonicalDecisionSection(header: string): string {
  const h = header.trim();
  if (/المبدأ|المبادئ/.test(h)) return "المبدأ";
  // "لهذه الأسباب" opens the operative part — check it before "الأسباب".
  if (/لهذه\s+الأسباب|المنطوق|^الحكم|^القرار/.test(h)) return "المنطوق";
  if (/الأسباب|أسباب\s+الحكم/.test(h)) return "الأسباب";
  if (/الوقائع|الإجراءات|الطلبات/.test(h)) return "الوقائع";
  return "أخرى";
}

function splitDecisionSections(text: string): { text: string; section: string }[] {
  const lines = text.split("\n");
  const out: { text: string; section: string }[] = [];
  let buf: string[] = [];
  let section = "أخرى"; // the head matter before the first labelled section

  const push = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ text: t, section });
    buf = [];
  };

  for (const line of lines) {
    if (SECTION_RE.test(line) && buf.join("\n").trim().length > 0) {
      push();
      section = canonicalDecisionSection(line);
    } else if (SECTION_RE.test(line)) {
      // Header with nothing before it yet — just adopt the section label.
      section = canonicalDecisionSection(line);
    }
    buf.push(line);
  }
  push();
  return out.filter((p) => p.text);
}

/**
 * Sets provesChunkIndex on every principle chunk to the reasoning that
 * establishes it — the first الأسباب chunk, or the المنطوق if there is none.
 * A principle with neither keeps null rather than pointing at nothing.
 */
function linkPrinciplesToProof(chunks: LegalChunk[]): LegalChunk[] {
  const reasoningIdx = chunks.findIndex((c) => c.decisionSection === "الأسباب");
  const rulingIdx = chunks.findIndex((c) => c.decisionSection === "المنطوق");
  const proofIdx = reasoningIdx !== -1 ? reasoningIdx : rulingIdx;
  if (proofIdx === -1) return chunks;

  for (const c of chunks) {
    if (c.decisionSection === "المبدأ") c.provesChunkIndex = proofIdx;
  }
  return chunks;
}

// ------------------------------------------------------------------ builders

function blank(): LegalChunk {
  return { text: "", articleNumber: null, ...EMPTY, keywords: [], legalTopics: [] };
}

function mk(text: string, articleNumber: string | null, part: string | null, chapter: string | null, section: string | null): LegalChunk {
  return { text, articleNumber, part, chapter, section, decisionSection: null, provesChunkIndex: null, keywords: [], legalTopics: [] };
}

// ------------------------------------------------------------------ windowing

/**
 * Paragraph-packing window with overlap. Overlap exists so a rule split across
 * a boundary is still fully present in at least one chunk.
 */
function slidingWindow(text: string): string[] {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim());
  const out: string[] = [];
  let buf = "";

  const push = () => {
    if (buf.trim()) out.push(buf.trim());
  };

  for (const para of paras) {
    // A single paragraph over the limit can't be packed — hard-split it.
    if (para.length > MAX_CHARS) {
      push();
      buf = "";
      for (const piece of hardSplit(para)) out.push(piece);
      continue;
    }

    if (buf.length + para.length + 2 > TARGET_CHARS && buf.length > 0) {
      push();
      buf = tail(buf, OVERLAP_CHARS) + "\n\n" + para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  push();

  return out.length ? out : [text.trim()].filter(Boolean);
}

/** Splits an oversized paragraph on sentence ends, never mid-word. */
function hardSplit(para: string): string[] {
  const sentences = para.split(/(?<=[.؟!؛])\s+/);
  const out: string[] = [];
  let buf = "";

  for (const s of sentences) {
    if (buf.length + s.length + 1 > TARGET_CHARS && buf.length > 0) {
      out.push(buf.trim());
      buf = tail(buf, OVERLAP_CHARS) + " " + s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
    // A "sentence" with no terminator can still exceed the cap.
    while (buf.length > MAX_CHARS) {
      out.push(buf.slice(0, TARGET_CHARS).trim());
      buf = buf.slice(TARGET_CHARS - OVERLAP_CHARS);
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Last n chars, snapped to a word boundary so overlap never starts mid-word. */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const slice = s.slice(-n);
  const sp = slice.indexOf(" ");
  return sp === -1 ? slice : slice.slice(sp + 1);
}

// Arabic function words carry no retrieval signal but dominate raw frequency.
const STOPWORDS = new Set([
  "في","من","على","إلى","عن","مع","هذا","هذه","ذلك","التي","الذي","الذين","اللتي",
  "كان","كانت","يكون","تكون","قد","لقد","أن","إن","أنه","بأن","لا","ما","لم","لن",
  "كل","بعض","غير","بين","عند","بعد","قبل","حتى","أو","و","ثم","كما","حيث","إذا",
  "وقد","وفي","ومن","وعلى","التى","الى","انه","اذا","به","له","بها","لها","منها",
  "عليه","عليها","فيه","فيها","ذات","دون","سوى","أي","اية","أية","هو","هي","هم",
]);

/**
 * Frequency-based keyword extraction — no model call, so it stays free and
 * runs on every chunk. Feeds the keywords[] column and the topics panel.
 */
export function extractKeywords(text: string, limit = 8): string[] {
  const words = text
    .replace(/[^؀-ۿ\w\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  return [...freq.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}
