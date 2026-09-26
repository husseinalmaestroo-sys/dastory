import "server-only";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { stemArabicWord } from "../search/arabic-stem";
import { extractAllLawReferences, sourceIsLaw } from "../search/law-reference";
import type { RetrievedChunk } from "../search/types";

/**
 * CLAIM-LEVEL GROUNDING (Phase 2, steps 17/18/23/24).
 *
 * `grounded = true` used to mean "at least one source was retrieved" (case
 * analysis, contract review) or simply "this is a draft" (drafting) — the
 * model's say-so, never checked. This module checks the generated text
 * against the exact sources it cites, sentence by sentence, in code:
 *
 *   claim → the [n] it cites → that source's text and metadata
 *
 * and decides, per sentence, whether it may be shown as source-backed.
 *
 * WHAT IS VERIFIED DETERMINISTICALLY (citation rules 1-7 of the Phase 2 spec)
 *   1/2/5  a cited [n] must denote a retrieved source (out-of-range markers
 *          are stripped — guard.ts stripInvalidCitations — and an article /
 *          decision number must match the cited source: guard.ts
 *          verifyCitedNumbers, run before this);
 *   3/4    the cited source is in the served corpus (retrieval filters: JO,
 *          non-synthetic, current version unless history was asked for); a
 *          claim citing a superseded version must say so — otherwise it is
 *          labelled here;
 *   6      every quotation (≥ 3 words between quote marks) must occur
 *          verbatim (after orthographic folding) in the cited source(s);
 *   7      support: the sentence's content words must overlap the cited
 *          source's text (lexical support score, threshold SUPPORT_MIN);
 *          every number in the sentence must occur in the cited source text
 *          or its citation metadata; a law the sentence names must be the
 *          law of the source it cites.
 *   and    a legal claim with no valid citation is removed.
 *
 * WHAT IT CANNOT VERIFY — stated, not hidden: the support score is lexical,
 * not semantic. A sentence that reuses a source's words while reversing its
 * meaning ("لا يجوز" → "يجوز") can score as supported; numbers written as
 * words ("ثلاثون يوماً") are not number-checked. Semantic support is the
 * self-verification judge's job (self-verify.ts) and the live evaluation's.
 *
 * OUTCOMES per sentence: supported | qualified (kept, visibly labelled as an
 * inference / unverified figure / superseded text) | removed. The answer's
 * grounding level is full (every claim supported), partial (something was
 * qualified or removed), or none (no supported claim survived — the pipeline
 * then shows the retrieved sources instead of the answer).
 */

export type GroundingIssue =
  | "no_citation"
  | "invalid_citation"
  | "fabricated_quote"
  | "unsupported_number"
  | "law_mismatch"
  | "weak_support"
  | "historical_unlabelled"
  | "fabricated_url";

export type ClaimKind = "quote" | "source_fact" | "inference" | "limitation";
export type ClaimStatus = "supported" | "qualified" | "removed";

export type ClaimCheck = {
  /** The sentence as shown (after any redaction/label), or as it was before removal. */
  text: string;
  refs: number[];
  kind: ClaimKind;
  status: ClaimStatus;
  issues: GroundingIssue[];
  /** Lexical support 0..1 (1 when the sentence is too short to judge). */
  support: number;
  /** The passage of the cited source that best supports the claim. */
  evidence: { ref: number; excerpt: string } | null;
};

export type GroundingLevel = "full" | "partial" | "none";

export type GroundingReport = {
  text: string;
  level: GroundingLevel;
  claims: ClaimCheck[];
  counts: {
    claims: number;
    supported: number;
    qualified: number;
    removed: number;
    redactedNumbers: number;
    strippedCitations: number;
  };
};

/** Minimum share of a claim's content words found in its cited sources. Set before evaluation (documented in AI_EVALUATION / PHASE2_REPORT). */
export const SUPPORT_MIN = 0.35;

export const NUMBER_REDACTION = "[رقم غير مُتحقَّق منه]";
export const INFERENCE_LABEL = " (استنتاج — لم يُتحقَّق من وروده نصاً في المصادر)";
export const HISTORICAL_LABEL = " (نص سابق غير نافذ حالياً)";

// Sentences that state a limitation of the sources rather than a legal rule.
const LIMITATION_RE =
  /لم\s*(?:تتضمن|تتناول|تذكر|يرد|ترد|أجد|اجد|تشر|تنص)|لا\s*(?:تتضمن|تتناول|تذكر|يوجد|توجد|تشمل|تنص|تغطي)|خارج\s*نطاق|حدود\s*الإجابة|لم\s*يتوفر|غير\s*(?:مذكور|وارد|متوفر)|does not (?:contain|cover|address)|not (?:covered|found)|no (?:source|provision)/i;
// Answer-structure labels the prompt asks for.
const LABEL_RE = /^(الخلاصة|النص القانوني|الشرح|حدود الإجابة|التفسير)\s*[:：]\s*/;
// A legal claim: legal vocabulary (folded forms) or any figure.
const LEGAL_CUE_RE =
  /ماده|المواد|قانون|نظام|تعليمات|دستور|يعاقب|عقوب|غرام|حبس|سجن|اشغال|يجوز|يلتزم|يلزم|يحق|حق\b|يستحق|تستحق|مده|خلال|ميعاد|تقادم|يشترط|شرط|باطل|بطلان|يعتبر|تعتبر|ينص|تنص|حكم|محكمه|قرار|دعوي|عقد|اجر|تعويض|فسخ|انهاء|التزام|مسوول|مسؤول|يترتب|يسقط|سقوط|اختصاص|استيناف|تمييز|طعن|جريمه|جرم|مخالفه|رسوم|ضريبه|يفرض|يمنع|يحظر|واجب|اثبات|بينه|article|law|shall|penalt|fine|imprison|court|contract|liab|entitled|days|years/i;
const INFERENCE_MARK_RE = /ويستفاد|يستفاد من ذلك|والظاهر|يمكن القول|ومفاد ذلك|يفهم من/;
// Penalties, periods and amounts: a weakly supported claim of this kind is
// removed rather than labelled — a wrong sanction or deadline is the costliest
// error an answer can carry.
const HIGH_RISK_RE = /يعاقب|عقوب|حبس|سجن|اشغال|غرام|اعدام|مده|ميعاد|تقادم|خلال|يوم|ايام|شهر|اشهر|سنه|سنوات|سنتين|دينار|penalt|fine|imprison|days|months|years/i;
const HISTORICAL_CUE_RE = /سابق|ملغ|قبل التعديل|لم يعد|غير نافذ|كان ينص|النسخه|المعدل|الملغي|previous|repealed|former/i;

const REF_RE = /\[(\d{1,2})\]/g;
const URL_RE = /\bhttps?:\/\/[^\s)\]»"]+|\bwww\.[^\s)\]»"]+/gi;
const QUOTE_RE = /"([^"\n]{2,1500})"|«([^»\n]{2,1500})»|“([^”\n]{2,1500})”/g;

const STOP = new Set(
  [
    "في", "من", "على", "الى", "عن", "ان", "او", "ما", "هل", "هو", "هي", "التي", "الذي", "الذين", "هذا", "هذه", "ذلك",
    "تلك", "كل", "اي", "مع", "بين", "قد", "لا", "لم", "لن", "ثم", "و", "كان", "كانت", "يكون", "تكون", "به", "بها",
    "له", "لها", "فيه", "فيها", "عليه", "عليها", "منه", "منها", "وفقا", "وفق", "حسب", "لذلك", "ذلك", "كما", "اذا",
    "حيث", "انه", "انها", "بان", "يمكن", "عند", "بعد", "قبل", "غير", "ايضا", "اما", "الا", "سوف", "مصدر", "المصدر",
    "الخلاصه", "الشرح", "النص", "القانوني", "المحامي", "the", "a", "an", "of", "to", "in", "and", "or", "is", "are",
  ].map((w) => foldForSearch(w))
);

function norm(text: string): string {
  return foldForSearch(normalizeDigits(text))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stems(text: string): string[] {
  return norm(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => stemArabicWord(w) || w);
}

/**
 * Splits a paragraph into sentences without breaking inside quotations or
 * decimals, keeping each sentence's trailing [n] markers with it — and moving
 * markers that open a sentence ("… الأجر. [1] ويجوز …") back to the one they
 * belong to.
 */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let buf = "";
  let closer: string | null = null;
  let quoteLen = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    buf += ch;
    if (closer) {
      quoteLen++;
      if (ch === closer || quoteLen > 1500) closer = null;
      continue;
    }
    if (ch === '"' || ch === "«" || ch === "“") {
      closer = ch === "«" ? "»" : ch === "“" ? "”" : '"';
      quoteLen = 0;
      continue;
    }
    if (".؟!؛?".includes(ch)) {
      if (ch === ".") {
        const next = paragraph[i + 1] ?? "";
        // Not a sentence end: a decimal, a dot inside a URL or token ("laws.example"),
        // or the article abbreviation "م." before its number.
        if (next && !/[\s["«“»”]/.test(next)) continue;
        if (/(?:^|[\s(])م$/.test(buf.slice(0, -1))) continue;
      }
      const trailing = paragraph.slice(i + 1).match(/^(\s*\[\d{1,2}\])+[.؟!؛]?/);
      if (trailing) {
        buf += trailing[0];
        i += trailing[0].length;
      }
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());

  // "…الأجر. [1] ويجوز…" → the marker belongs to the previous sentence.
  for (let k = 1; k < out.length; k++) {
    const lead = out[k].match(/^(\[\d{1,2}\]\s*)+/);
    if (lead) {
      out[k - 1] = `${out[k - 1]} ${lead[0].trim()}`;
      out[k] = out[k].slice(lead[0].length).trim();
    }
  }
  return out.filter((s) => s.length > 0);
}

function quotesIn(sentence: string): string[] {
  return [...sentence.matchAll(QUOTE_RE)].map((m) => m[1] ?? m[2] ?? m[3]).filter((q) => q.trim().split(/\s+/).length >= 3);
}

/** A quotation is genuine when each of its segments (split on an ellipsis) occurs verbatim, after folding, in the cited text. */
export function quoteIsVerbatim(quote: string, sourceText: string): boolean {
  const hay = ` ${norm(sourceText)} `;
  const segments = quote
    .split(/\.{3}|…/)
    .map((s) => norm(s))
    .filter((s) => s.split(" ").length >= 3);
  if (segments.length === 0) return true; // nothing substantive to check
  return segments.every((seg) => hay.includes(` ${seg} `) || hay.includes(seg));
}

function sourceCorpus(c: RetrievedChunk): { text: string; numbers: Set<string> } {
  const meta = [c.source_title, c.law_name, c.law_number, c.article_number, c.decision_number, c.year, c.court, c.effective_date]
    .filter((x) => x !== null && x !== undefined)
    .join(" ");
  const text = `${meta}\n${c.chunk_text}`;
  const numbers = new Set([...normalizeDigits(text).matchAll(/\d+/g)].map((m) => m[0].replace(/^0+(?=\d)/, "")));
  return { text, numbers };
}

function bestEvidence(sentence: string, refs: number[], chunks: RetrievedChunk[]): { ref: number; excerpt: string } | null {
  const want = new Set(stems(sentence));
  let best: { ref: number; excerpt: string; score: number } | null = null;
  for (const ref of refs) {
    const c = chunks[ref - 1];
    if (!c) continue;
    for (const s of c.chunk_text.split(/(?<=[.؛:!؟])\s+|\n+/)) {
      const t = s.trim();
      if (!t) continue;
      let score = 0;
      for (const w of new Set(stems(t))) if (want.has(w)) score++;
      if (!best || score > best.score) best = { ref, excerpt: t.slice(0, 240), score };
    }
  }
  return best ? { ref: best.ref, excerpt: best.excerpt } : null;
}

type Options = {
  /** The question — figures the lawyer wrote may be repeated in a limitation/correction sentence. */
  question?: string;
};

/**
 * Grounds `answer` against the `chunks` its [n] markers refer to. Run AFTER
 * guard.ts's stripInvalidCitations/verifyCitedNumbers (article-number checks).
 */
export function groundAnswer(answer: string, chunks: RetrievedChunk[], opts: Options = {}): GroundingReport {
  const claims: ClaimCheck[] = [];
  let redactedNumbers = 0;
  let strippedCitations = 0;
  const questionNumbers = new Set([...normalizeDigits(opts.question ?? "").matchAll(/\d+/g)].map((m) => m[0]));
  const corpora = chunks.map(sourceCorpus);

  const paragraphs = answer.split(/\n\s*\n|\n/);
  const outParagraphs: string[] = [];

  for (const paragraph of paragraphs) {
    const sentencesOut: string[] = [];
    let previousRefs: number[] = [];

    for (const raw of splitSentences(paragraph)) {
      // 1. Citation markers: drop any that do not denote a retrieved source.
      let sentence = raw.replace(REF_RE, (m, n) => {
        const k = Number(n);
        if (k >= 1 && k <= chunks.length) return m;
        strippedCitations++;
        return "";
      });
      // A URL is a citation too: only a cited source's own recorded URL may appear.
      const allowedUrls = new Set(chunks.map((c) => c.source_url).filter((u): u is string => !!u));
      let urlRemoved = false;
      sentence = sentence.replace(URL_RE, (u) => {
        if (allowedUrls.has(u)) return u;
        urlRemoved = true;
        return "";
      });
      const ownRefs = [...new Set([...sentence.matchAll(REF_RE)].map((m) => Number(m[1])))];
      const labelMatch = sentence.match(LABEL_RE);
      const body = sentence.replace(LABEL_RE, "").replace(REF_RE, "").trim();
      const folded = norm(body);

      if (!body) {
        // A bare label ("الخلاصة:") — kept only if something follows it.
        if (labelMatch) sentencesOut.push(sentence.trim());
        continue;
      }

      const isLimitation = LIMITATION_RE.test(body) || labelMatch?.[1] === "حدود الإجابة";
      const hasFigure = /\d/.test(normalizeDigits(body));
      const isClaim = !isLimitation && (LEGAL_CUE_RE.test(folded) || hasFigure);

      if (!isClaim && !isLimitation) {
        // Connective prose — no legal content to verify.
        sentencesOut.push(sentence);
        continue;
      }

      const issues: GroundingIssue[] = [];
      if (strippedHere(raw, sentence)) issues.push("invalid_citation");
      if (urlRemoved) issues.push("fabricated_url");

      // A claim without its own marker inherits the previous cited sentence's
      // sources in the same paragraph ("…[1]. وبالتالي يستحق العامل…").
      const refs = ownRefs.length ? ownRefs : isClaim ? previousRefs : [];
      const cited = refs.map((r) => chunks[r - 1]).filter(Boolean);
      const citedText = refs.map((r) => corpora[r - 1]?.text ?? "").join("\n");
      const citedNumbers = new Set(refs.flatMap((r) => [...(corpora[r - 1]?.numbers ?? [])]));

      // Figures: every number outside a quotation must come from the cited
      // source (or, in a limitation sentence, from the question itself).
      const quoted = quotesIn(sentence);
      let figureChecked = sentence;
      for (const q of quoted) figureChecked = figureChecked.replace(q, " ");
      const badNumbers = [...normalizeDigits(figureChecked.replace(REF_RE, " ")).matchAll(/\d+(?:[.,]\d+)?/g)]
        .map((m) => m[0])
        .filter((n) => {
          const bare = n.replace(/^0+(?=\d)/, "");
          if (citedNumbers.has(bare)) return false;
          if (isLimitation && questionNumbers.has(bare)) return false;
          return true;
        });

      if (isLimitation) {
        let text = normalizeDigits(sentence);
        for (const n of badNumbers) {
          text = text.replace(numberPattern(n), NUMBER_REDACTION);
          redactedNumbers++;
        }
        claims.push({ text, refs, kind: "limitation", status: badNumbers.length ? "qualified" : "supported", issues: badNumbers.length ? ["unsupported_number"] : [], support: 1, evidence: null });
        sentencesOut.push(text);
        continue;
      }

      if (refs.length === 0 || cited.length === 0) {
        claims.push({ text: sentence, refs: [], kind: "source_fact", status: "removed", issues: [...issues, "no_citation"], support: 0, evidence: null });
        continue;
      }

      // Quotations must be verbatim.
      if (quoted.some((q) => !quoteIsVerbatim(q, citedText))) {
        claims.push({ text: sentence, refs, kind: "quote", status: "removed", issues: [...issues, "fabricated_quote"], support: 0, evidence: null });
        continue;
      }

      // A law the sentence names must be the law of a source it cites.
      const lawRefs = extractAllLawReferences(body);
      if (lawRefs.some((lr) => !cited.some((c) => sourceIsLaw(lr, { lawName: c.law_name, title: c.source_title })))) {
        claims.push({ text: sentence, refs, kind: "source_fact", status: "removed", issues: [...issues, "law_mismatch"], support: 0, evidence: null });
        continue;
      }

      let text = normalizeDigits(sentence);
      for (const n of badNumbers) {
        text = text.replace(numberPattern(n), NUMBER_REDACTION);
        redactedNumbers++;
      }
      if (badNumbers.length) issues.push("unsupported_number");

      // Lexical support of the words outside quotations.
      const words = stems(quoted.reduce((acc, q) => acc.replace(q, " "), body));
      const sourceWords = new Set(stems(citedText));
      const support = words.length < 3 ? 1 : words.filter((w) => sourceWords.has(w)).length / words.length;
      const labelledInference = INFERENCE_MARK_RE.test(folded);
      let kind: ClaimKind = quoted.length ? "quote" : labelledInference ? "inference" : "source_fact";
      if (support < SUPPORT_MIN) {
        issues.push("weak_support");
        // Weak support is only tolerable, as a labelled inference, for a
        // sentence that cites its own source and states no sanction/period/
        // amount. An uncited sentence merely following a cited one, or a weak
        // penalty/deadline claim, is removed.
        if (ownRefs.length === 0 || HIGH_RISK_RE.test(folded)) {
          if (ownRefs.length === 0) issues.push("no_citation");
          claims.push({ text: sentence, refs, kind: "inference", status: "removed", issues, support: Number(support.toFixed(3)), evidence: null });
          continue;
        }
        // Citation rule 7: a citation that does not support its claim is
        // wrong even if the source exists — so the [n] markers come off and
        // the sentence is labelled as an unverified inference.
        text = text.replace(/\s*\[\d{1,2}\]/g, "");
        text = appendLabel(text, INFERENCE_LABEL);
        kind = "inference";
      }

      // A superseded version must be labelled as such.
      if (cited.some((c) => c.is_current_version === false) && !HISTORICAL_CUE_RE.test(folded)) {
        issues.push("historical_unlabelled");
        text = appendLabel(text, HISTORICAL_LABEL);
      }

      const status: ClaimStatus = issues.some(
        (i) => i === "unsupported_number" || i === "weak_support" || i === "historical_unlabelled" || i === "fabricated_url"
      )
        ? "qualified"
        : "supported";
      claims.push({ text, refs, kind, status, issues, support: Number(support.toFixed(3)), evidence: bestEvidence(body, refs, chunks) });
      sentencesOut.push(text);
      previousRefs = refs;
    }

    // Drop a paragraph reduced to a bare label.
    const joined = sentencesOut.join(" ").trim();
    if (joined.replace(LABEL_RE, "").trim()) outParagraphs.push(joined);
  }

  const counted = claims.filter((c) => c.kind !== "limitation");
  const supported = counted.filter((c) => c.status === "supported").length;
  const qualified = counted.filter((c) => c.status === "qualified").length;
  const removed = counted.filter((c) => c.status === "removed").length;
  const level: GroundingLevel =
    supported + qualified === 0 ? "none" : qualified === 0 && removed === 0 ? "full" : "partial";

  return {
    text: outParagraphs.join("\n\n").trim(),
    level,
    claims,
    counts: { claims: counted.length, supported, qualified, removed, redactedNumbers, strippedCitations },
  };
}

/** True when stripping out-of-range markers changed the sentence. */
function strippedHere(raw: string, sentence: string): boolean {
  return (raw.match(REF_RE) ?? []).length > (sentence.match(REF_RE) ?? []).length;
}

/** Matches the figure `n` as a whole number, never inside a "[n]" citation marker. */
function numberPattern(n: string): RegExp {
  return new RegExp(`(?<![\\d\\[.,])${n.replace(/[.,]/g, "[.,]")}(?![\\d\\]])`);
}

/** Inserts a label before the sentence's trailing citation markers/punctuation. */
function appendLabel(sentence: string, label: string): string {
  const m = sentence.match(/((?:\s*\[\d{1,2}\])*\s*[.؟!؛]?\s*)$/);
  const tail = m ? m[1] : "";
  return `${sentence.slice(0, sentence.length - tail.length)}${label}${tail}`;
}
