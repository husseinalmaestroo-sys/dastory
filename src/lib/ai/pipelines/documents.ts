import "server-only";
import { logError } from "../../error-log";
import type { Caller } from "../../caller";
import { hybridSearch, getChunksByIds } from "../../search/hybrid";
import type { RetrievedChunk } from "../../search/types";
import { fieldsOf, formatFields, hasSubstantialNotes, type DraftKind } from "../../drafting/forms";
import { getChatProvider } from "../index";
import {
  buildCaseAnalysisPrompt,
  buildContractReviewPrompt,
  buildDraftPrompt,
  buildRefineSectionPrompt,
  leakReferenceTexts,
  type RefineAction,
} from "../prompts";
import { redactCitations, stripInvalidCitations, verifyCitedNumbers } from "../guard";
import {
  validateCaseAnalysis,
  validateContractReview,
  validateDraft,
  type CaseAnalysis,
  type CaseValidationReport,
  type ContractReview,
  type ContractRisk,
  type ContractValidationReport,
  type DraftValidationReport,
} from "../output-schemas";
import { detectPromptLeak } from "../untrusted";
import type { GroundingLevel } from "../grounding";
import { toCitation, type Citation } from "./chat";
import type { RequestOutcome } from "../request";

/**
 * Document features: case analysis, contract review, drafting, refining.
 * Same contract as the chat pipeline — fenced prompts, validated output,
 * nothing unvalidated returned, explicit coverage — and no storage: these
 * functions keep nothing; the standalone route decides separately whether
 * its own user's content is retained (Dostoori's never is).
 */

/** Characters of a document the retrieval query is built from. */
const QUERY_TEXT_CHARS = 3000;
/** Characters one analysis call reads. */
export const SEGMENT_CHARS = 24_000;
/** Most segments one contract review will analyse. */
export const MAX_CONTRACT_SEGMENTS = 4;
/** The largest contract reviewed in full. Beyond it the review is explicitly PARTIAL. */
export const MAX_CONTRACT_FULL_REVIEW_CHARS = SEGMENT_CHARS * MAX_CONTRACT_SEGMENTS;

export type Coverage = {
  totalChars: number;
  analyzedChars: number;
  /** True when part of the document was NOT analysed — the UI must say "PARTIAL REVIEW". */
  partial: boolean;
  segments: number;
  /** What was not analysed, by character range and the first line of that range. */
  notAnalyzed: { fromChar: number; toChar: number; startsWith: string }[];
};

function uncovered(text: string, from: number): Coverage["notAnalyzed"][number] {
  return { fromChar: from + 1, toChar: text.length, startsWith: text.slice(from, from + 120).split("\n")[0].trim() };
}

function leaks(output: string): boolean {
  return detectPromptLeak(output, leakReferenceTexts());
}

const invalid = (detail: string, retrieval = 0): { outcome: RequestOutcome; invalid: string } => ({
  invalid: detail,
  outcome: { success: false, outcome: "invalid_output", groundingLevel: "none", retrievalCount: retrieval, sourceCount: 0 },
});

// ------------------------------------------------------------------ case analysis

export type CaseAnalysisOutcome =
  | {
      analysis: CaseAnalysis;
      validation: CaseValidationReport;
      coverage: Coverage;
      sources: Citation[];
      groundingLevel: GroundingLevel;
      outcome: RequestOutcome;
    }
  | { invalid: string; outcome: RequestOutcome };

export async function runCaseAnalysis(caseText: string, _caller: Caller): Promise<CaseAnalysisOutcome> {
  const analyzed = caseText.slice(0, SEGMENT_CHARS);
  const coverage: Coverage = {
    totalChars: caseText.length,
    analyzedChars: analyzed.length,
    partial: caseText.length > SEGMENT_CHARS,
    segments: 1,
    notAnalyzed: caseText.length > SEGMENT_CHARS ? [uncovered(caseText, SEGMENT_CHARS)] : [],
  };

  // The uploaded file is evidence to analyse, never an authority to cite:
  // retrieval grounds the analysis in the shared corpus.
  const { chunks } = await hybridSearch(caseText.slice(0, QUERY_TEXT_CHARS), {}, 10);

  const note = coverage.partial
    ? `هذا هو الجزء الأول فقط من الملف (${analyzed.length} من ${caseText.length} حرفاً). لا تفترض شيئاً عن بقية الملف.`
    : undefined;
  const { system, user } = buildCaseAnalysisPrompt(analyzed, chunks, note);
  const res = await getChatProvider().chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 2500, purpose: "case_analysis" }
  );
  if (leaks(res.text)) return invalid("output reproduced system instructions", chunks.length);

  const v = validateCaseAnalysis(res.text, analyzed, chunks);
  if (!v.ok) {
    logError(`[cases] model output rejected (${v.reason}): ${v.detail}`, null);
    return invalid(v.detail, chunks.length);
  }
  const cited = new Set(
    [...v.analysis.legal_basis, ...v.analysis.possible_defenses, ...v.analysis.strengths, ...v.analysis.weaknesses]
      .map((i) => Number(i.citation?.match(/\d+/)?.[0]))
      .filter(Boolean)
  );
  return {
    analysis: v.analysis,
    validation: v.report,
    coverage,
    sources: chunks.map((c, i) => toCitation(c, i, cited.has(i + 1))),
    groundingLevel: v.report.groundingLevel,
    outcome: {
      success: true,
      outcome: coverage.partial ? "partial_coverage" : "complete",
      groundingLevel: v.report.groundingLevel,
      retrievalCount: chunks.length,
      sourceCount: cited.size,
    },
  };
}

// ------------------------------------------------------------------ contract review

/**
 * Splits a contract into ≤ SEGMENT_CHARS pieces at clause boundaries (a line
 * starting with البند/المادة/Clause/Article or a number), falling back to a
 * paragraph break, and only then to a hard cut. No clause is dropped: the
 * pieces concatenate back to the whole text.
 */
export function segmentContract(text: string, max = SEGMENT_CHARS): string[] {
  const segments: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const clauseBreak = Math.max(
      ...[...window.matchAll(/\n(?=\s*(?:البند|المادة|الفقرة|أولاً|ثانياً|Clause|Article|Section|\d{1,3}[.)-]))/g)].map((m) => m.index ?? -1)
    );
    const paraBreak = window.lastIndexOf("\n\n");
    const cut = clauseBreak > max * 0.5 ? clauseBreak : paraBreak > max * 0.5 ? paraBreak : max;
    segments.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) segments.push(rest);
  return segments;
}

export type ContractReviewOutcome =
  | {
      review: ContractReview;
      validation: ContractValidationReport;
      coverage: Coverage;
      sources: Citation[];
      outcome: RequestOutcome;
    }
  | { invalid: string; outcome: RequestOutcome };

export async function runContractReview(contractText: string, _caller: Caller): Promise<ContractReviewOutcome> {
  const allSegments = segmentContract(contractText);
  const segments = allSegments.slice(0, MAX_CONTRACT_SEGMENTS);
  // One retrieval for the whole contract: every segment cites the same
  // numbered source list, so [n] means the same source across the merged review.
  const { chunks } = await hybridSearch(contractText.slice(0, QUERY_TEXT_CHARS), {}, 8);

  const provider = getChatProvider();
  let offset = 0;
  const plans = segments.map((seg, i) => {
    const plan = { seg, from: offset, index: i };
    offset += seg.length;
    return plan;
  });

  type SegmentResult = { ok: true; review: ContractReview; report: ContractValidationReport } | { ok: false; from: number; to: number };
  const reviewOne = async (p: (typeof plans)[number]): Promise<SegmentResult> => {
    const note =
      segments.length > 1 || allSegments.length > 1
        ? `هذا هو الجزء ${p.index + 1} من ${allSegments.length} من العقد (الأحرف ${p.from + 1}–${p.from + p.seg.length} من ${contractText.length}). راجع هذا الجزء فقط، ولا تعدّ بنداً ناقصاً لمجرد أنه قد يرد في جزء آخر.`
        : undefined;
    try {
      const { system, user } = buildContractReviewPrompt(p.seg, chunks, note);
      const res = await provider.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: 3000, purpose: "contract_review" }
      );
      if (leaks(res.text)) return { ok: false, from: p.from, to: p.from + p.seg.length };
      const v = validateContractReview(res.text, contractText, chunks);
      if (!v.ok) {
        logError(`[contract-review] segment ${p.index + 1} output rejected (${v.reason}): ${v.detail}`, null);
        return { ok: false, from: p.from, to: p.from + p.seg.length };
      }
      return { ok: true, review: v.review, report: v.report };
    } catch (err) {
      logError(`[contract-review] segment ${p.index + 1} failed:`, err);
      return { ok: false, from: p.from, to: p.from + p.seg.length };
    }
  };

  // Two segments at a time: bounded parallelism, bounded cost.
  const results: SegmentResult[] = [];
  for (let i = 0; i < plans.length; i += 2) {
    results.push(...(await Promise.all(plans.slice(i, i + 2).map(reviewOne))));
  }

  const good = results.filter((r): r is Extract<SegmentResult, { ok: true }> => r.ok);
  if (good.length === 0) return invalid("no segment produced a valid review", chunks.length);

  const notAnalyzed: Coverage["notAnalyzed"] = results
    .filter((r): r is Extract<SegmentResult, { ok: false }> => !r.ok)
    .map((r) => ({ fromChar: r.from + 1, toChar: r.to, startsWith: contractText.slice(r.from, r.from + 120).split("\n")[0].trim() }));
  if (allSegments.length > segments.length) notAnalyzed.push(uncovered(contractText, offset));
  const analyzedChars = contractText.length - notAnalyzed.reduce((n, r) => n + (r.toChar - r.fromChar + 1), 0);

  const seenParty = new Set<string>();
  const seenTerm = new Set<string>();
  const seenRisk = new Set<string>();
  const review: ContractReview = {
    summary: good[0].review.summary,
    parties: good.flatMap((g) => g.review.parties).filter((p) => !seenParty.has(p) && !!seenParty.add(p)),
    keyTerms: good
      .flatMap((g) => g.review.keyTerms)
      .filter((k) => {
        const key = `${k.label}|${k.value}`;
        return !seenTerm.has(key) && !!seenTerm.add(key);
      }),
    risks: good
      .flatMap((g) => g.review.risks)
      .filter((r: ContractRisk) => {
        const key = `${r.title}|${r.excerpt}`;
        return !seenRisk.has(key) && !!seenRisk.add(key);
      }),
  };
  const validation = good.reduce<ContractValidationReport>(
    (acc, g) => ({
      droppedParties: acc.droppedParties + g.report.droppedParties,
      unverifiedExcerpts: acc.unverifiedExcerpts + g.report.unverifiedExcerpts,
      redactedFigures: acc.redactedFigures + g.report.redactedFigures,
      strippedCitations: acc.strippedCitations + g.report.strippedCitations,
      redactedCitations: acc.redactedCitations + g.report.redactedCitations,
    }),
    { droppedParties: 0, unverifiedExcerpts: 0, redactedFigures: 0, strippedCitations: 0, redactedCitations: 0 }
  );
  const coverage: Coverage = {
    totalChars: contractText.length,
    analyzedChars,
    partial: notAnalyzed.length > 0,
    segments: segments.length,
    notAnalyzed,
  };
  const cited = new Set(review.risks.flatMap((r) => [...r.explanation.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))));
  return {
    review,
    validation,
    coverage,
    sources: chunks.map((c, i) => toCitation(c, i, cited.has(i + 1))),
    outcome: {
      success: true,
      outcome: coverage.partial ? "partial_coverage" : "complete",
      groundingLevel: cited.size > 0 ? "partial" : "none",
      retrievalCount: chunks.length,
      sourceCount: cited.size,
    },
  };
}

// ------------------------------------------------------------------ drafting

export type DraftInput = { kind: DraftKind; fields: Record<string, string>; notes: string };

export type DraftOutcome =
  | {
      draft: string;
      groundingLevel: GroundingLevel;
      validation: DraftValidationReport;
      sources: Citation[];
      outcome: RequestOutcome;
    }
  | { missing: string[]; outcome: RequestOutcome }
  | { noEvidence: true; outcome: RequestOutcome }
  | { invalid: string; outcome: RequestOutcome };

export async function runDraft(input: DraftInput, _caller: Caller): Promise<DraftOutcome> {
  // Only ids the form declares: a value under an unknown key would reach the
  // prompt with no label to explain it.
  const spec = fieldsOf(input.kind);
  const values: Record<string, string> = {};
  for (const f of spec) {
    const v = input.fields[f.id]?.trim();
    if (v) values[f.id] = v;
  }
  const missing = spec.filter((f) => f.required && !values[f.id]);
  if (missing.length > 0 && !hasSubstantialNotes(input.notes)) {
    return { missing: missing.map((f) => f.label), outcome: { success: false, outcome: "invalid_input" } };
  }
  const instructions = [formatFields(input.kind, values), input.notes].filter(Boolean).join("\n");

  const [templates, law] = await Promise.all([hybridSearch(instructions, { sourceType: "template" }, 3), hybridSearch(instructions, {}, 6)]);
  const seen = new Set<number>();
  const chunks = [...templates.chunks, ...law.chunks].filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  if (chunks.length === 0) return { noEvidence: true, outcome: { success: true, outcome: "no_evidence", groundingLevel: "none", retrievalCount: 0, sourceCount: 0 } };

  const { system, user } = buildDraftPrompt(input.kind, values, input.notes, chunks);
  const res = await getChatProvider().chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 4000, purpose: "draft" }
  );
  if (leaks(res.text)) return invalid("output reproduced system instructions", chunks.length);
  const v = validateDraft(res.text, instructions, chunks);
  if (!v.ok) {
    logError(`[draft] model output rejected (${v.reason}): ${v.detail}`, null);
    return invalid(v.detail, chunks.length);
  }
  const cited = new Set([...v.draft.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  return {
    draft: v.draft,
    groundingLevel: v.groundingLevel,
    validation: v.report,
    sources: chunks.map((c, i) => toCitation(c, i, cited.has(i + 1))),
    outcome: { success: true, outcome: "drafted", groundingLevel: v.groundingLevel, retrievalCount: chunks.length, sourceCount: cited.size },
  };
}

export type RefineInput = {
  kind: DraftKind;
  action: RefineAction;
  sectionHeading: string;
  blockText: string;
  fullDraft: string;
  sourceIds: number[];
};

export type RefineOutcome =
  | { text: string; strippedCount: number; redactedCount: number; outcome: RequestOutcome }
  | { invalid: string; outcome: RequestOutcome };

export async function runRefine(input: RefineInput, _caller: Caller): Promise<RefineOutcome> {
  // Public-corpus chunk ids from the same draft's source list (never a fresh
  // retrieval — a [2] must keep denoting the same source across the document).
  const chunks: RetrievedChunk[] = await getChunksByIds(input.sourceIds);
  const { system, user } = buildRefineSectionPrompt(input.kind, input.action, input.sectionHeading, input.blockText, input.fullDraft, chunks);
  const res = await getChatProvider().chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 1500, purpose: "refine" }
  );
  if (leaks(res.text)) return invalid("output reproduced system instructions", chunks.length);
  const stripped = stripInvalidCitations(res.text, chunks.length);
  const checked = verifyCitedNumbers(stripped.text, chunks);
  // Uncited legal numbers are not allowed in a refined section either.
  let redacted = checked.redactedCount;
  const text = checked.text
    .split("\n")
    .map((line) => {
      if (/\[\d{1,2}\]/.test(line)) return line;
      const r = redactCitations(line);
      redacted += r.redactedCount;
      return r.text;
    })
    .join("\n");
  return {
    text,
    strippedCount: stripped.strippedCount,
    redactedCount: redacted,
    outcome: { success: true, outcome: "refined", groundingLevel: null, retrievalCount: chunks.length, sourceCount: chunks.length },
  };
}
