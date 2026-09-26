import "server-only";
import { z } from "zod";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import type { RetrievedChunk } from "../search/types";
import { groundAnswer, type GroundingLevel } from "./grounding";
import { redactCitations, stripInvalidCitations, verifyCitedNumbers } from "./guard";

/**
 * STRUCTURED OUTPUT VALIDATION (Phase 2, steps 27–30).
 *
 * Model output is untrusted until validated. Each JSON-producing feature has
 * a zod schema (types, required fields, length caps) AND content checks that
 * tie every claim back to something real:
 *   • case analysis — every party and fact must be evidenced by a verbatim
 *     excerpt of the uploaded file; an article the file "mentions" must be in
 *     it; every legal characterisation must cite a retrieved source and pass
 *     claim-level grounding;
 *   • contract review — parties must appear in the contract, excerpts must be
 *     verbatim, figures in key terms must be in the contract, citations in
 *     explanations must be valid and grounded, uncited article numbers are
 *     redacted;
 *   • drafts — citations valid and number-checked; every date, amount and
 *     id-like number must come from the lawyer's own input, or it is replaced
 *     by "[يُستكمل: …]".
 * Output that does not parse or does not match the schema FAILS — it is never
 * passed through as raw text (the old parseJsonAnalysis returned the model's
 * prose as `summary` with a parse_error flag, i.e. unvalidated text presented
 * as the analysis).
 */

export type ValidationFailure = { ok: false; reason: "unparseable" | "schema"; detail: string };

/** Extracts the JSON object from a reply (tolerates a ```json fence); null when there is none. */
export function extractJson(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function norm(text: string): string {
  return foldForSearch(normalizeDigits(text))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Verbatim (after orthographic folding / punctuation) containment. */
export function appearsIn(needle: string, haystackNorm: string): boolean {
  const n = norm(needle);
  return n.length > 0 && haystackNorm.includes(n);
}

const citationField = z
  .union([z.string().max(60), z.null()])
  .optional()
  .transform((v) => v ?? undefined);

// ------------------------------------------------------------------ case analysis

const CaseAnalysisRaw = z.object({
  summary: z.string().max(4000).default(""),
  parties: z
    .array(z.object({ role: z.string().max(40).default("أخرى"), name: z.string().min(1).max(200), excerpt: z.string().max(600).optional() }))
    .max(40)
    .default([]),
  facts: z
    .array(z.union([z.string().max(1500), z.object({ fact: z.string().max(1500), excerpt: z.string().max(800).optional() })]))
    .max(80)
    .default([]),
  case_type: z.string().max(40).optional(),
  cited_articles: z.array(z.string().max(300)).max(80).default([]),
  legal_basis: z.array(z.object({ point: z.string().max(1500), citation: citationField })).max(40).default([]),
  possible_defenses: z.array(z.object({ defense: z.string().max(1500), citation: citationField })).max(40).default([]),
  strengths: z.array(z.object({ point: z.string().max(1500), citation: citationField })).max(40).default([]),
  weaknesses: z.array(z.object({ point: z.string().max(1500), citation: citationField })).max(40).default([]),
  gaps: z.array(z.string().max(600)).max(40).default([]),
});

export type CaseAnalysis = {
  summary: string;
  parties: { role: string; name: string }[];
  facts: string[];
  /** Verbatim excerpt of the case file supporting each fact, same order as `facts`. */
  factEvidence: string[];
  case_type: string;
  cited_articles: string[];
  legal_basis: { point: string; citation?: string }[];
  possible_defenses: { defense: string; citation?: string }[];
  strengths: { point: string; citation?: string }[];
  weaknesses: { point: string; citation?: string }[];
  gaps: string[];
};

export type CaseValidationReport = {
  droppedParties: number;
  droppedFacts: number;
  droppedArticles: number;
  droppedLegalItems: number;
  qualifiedLegalItems: number;
  groundingLevel: GroundingLevel;
};

/** Grounds one "point [n]" item; null when it must be dropped. */
function groundItem(text: string, citation: string | undefined, chunks: RetrievedChunk[]): { text: string; citation: string; qualified: boolean } | null {
  const ref = citation?.match(/\[(\d{1,2})\]/)?.[1];
  if (!ref || Number(ref) < 1 || Number(ref) > chunks.length) return null;
  const marker = `[${Number(ref)}]`;
  const checked = verifyCitedNumbers(`${text.replace(/\[\d{1,2}\]/g, "").trim()} ${marker}`, chunks);
  const g = groundAnswer(checked.text, chunks);
  if (g.level === "none" || !g.text) return null;
  return { text: g.text.replace(/\s*\[\d{1,2}\]\s*\.?$/, "").trim(), citation: marker, qualified: g.level !== "full" };
}

export function validateCaseAnalysis(
  raw: string,
  caseText: string,
  chunks: RetrievedChunk[]
): { ok: true; analysis: CaseAnalysis; report: CaseValidationReport } | ValidationFailure {
  const json = extractJson(raw);
  if (json === null) return { ok: false, reason: "unparseable", detail: "no JSON object in model output" };
  const parsed = CaseAnalysisRaw.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema", detail: parsed.error.issues[0]?.message ?? "schema mismatch" };
  const a = parsed.data;
  const docNorm = norm(caseText);

  const parties = a.parties.filter((p) => appearsIn(p.name, docNorm)).map((p) => ({ role: p.role, name: p.name.trim() }));
  const facts: string[] = [];
  const factEvidence: string[] = [];
  for (const f of a.facts) {
    const fact = typeof f === "string" ? f : f.fact;
    const excerpt = typeof f === "string" ? f : (f.excerpt ?? "");
    // A fact is shown only with a verbatim excerpt of the file behind it —
    // either the declared excerpt, or the fact itself quoted from the file.
    if (excerpt && appearsIn(excerpt, docNorm)) {
      facts.push(fact.trim());
      factEvidence.push(excerpt.trim());
    } else if (appearsIn(fact, docNorm)) {
      facts.push(fact.trim());
      factEvidence.push(fact.trim());
    }
  }
  const citedArticles = a.cited_articles.filter((s) => {
    const n = normalizeDigits(s).match(/\d{1,4}/)?.[0];
    return !!n && new RegExp(`ماد[ةه]\\s*[({[]?\\s*${n}(?!\\d)`).test(normalizeDigits(caseText));
  });

  let dropped = 0;
  let qualified = 0;
  const legal = <T extends { citation?: string }>(items: T[], key: "point" | "defense") =>
    items.flatMap((it) => {
      const g = groundItem((it as unknown as Record<string, string>)[key], it.citation, chunks);
      if (!g) {
        dropped++;
        return [];
      }
      if (g.qualified) qualified++;
      return [{ [key]: g.text, citation: g.citation } as unknown as T];
    });

  const legal_basis = legal(a.legal_basis, "point");
  const possible_defenses = legal(a.possible_defenses, "defense");
  const strengths = legal(a.strengths, "point");
  const weaknesses = legal(a.weaknesses, "point");
  const kept = legal_basis.length + possible_defenses.length + strengths.length + weaknesses.length;

  // The summary describes the file: figures in it must come from the file.
  let summary = normalizeDigits(a.summary);
  const docDigits = new Set([...normalizeDigits(caseText).matchAll(/\d+/g)].map((m) => m[0]));
  summary = summary.replace(/\d+/g, (n) => (docDigits.has(n) ? n : "[رقم غير مُتحقَّق منه]"));
  summary = redactCitations(summary).text;

  return {
    ok: true,
    analysis: {
      summary,
      parties,
      facts,
      factEvidence,
      case_type: a.case_type ?? "أخرى",
      cited_articles: citedArticles,
      legal_basis: legal_basis as CaseAnalysis["legal_basis"],
      possible_defenses: possible_defenses as CaseAnalysis["possible_defenses"],
      strengths: strengths as CaseAnalysis["strengths"],
      weaknesses: weaknesses as CaseAnalysis["weaknesses"],
      gaps: a.gaps.map((g) => redactCitations(g).text),
    },
    report: {
      droppedParties: a.parties.length - parties.length,
      droppedFacts: a.facts.length - facts.length,
      droppedArticles: a.cited_articles.length - citedArticles.length,
      droppedLegalItems: dropped,
      qualifiedLegalItems: qualified,
      groundingLevel: kept === 0 ? "none" : dropped === 0 && qualified === 0 ? "full" : "partial",
    },
  };
}

// ------------------------------------------------------------------ contract review

const Severity = z.enum(["high", "medium", "low", "info"]).catch("info");

const ContractReviewRaw = z.object({
  summary: z.string().max(4000).default(""),
  parties: z.array(z.string().max(200)).max(30).default([]),
  keyTerms: z.array(z.object({ label: z.string().max(200), value: z.string().max(2000) })).max(100).default([]),
  risks: z
    .array(z.object({ severity: Severity, title: z.string().max(300), excerpt: z.string().max(1500).default(""), explanation: z.string().max(3000).default("") }))
    .max(100)
    .default([]),
});

export type ContractRisk = {
  severity: "high" | "medium" | "low" | "info";
  title: string;
  excerpt: string;
  explanation: string;
  /** False when the model's excerpt was not found verbatim in the contract (it is then blanked). */
  excerptVerified: boolean;
};

export type ContractReview = {
  summary: string;
  parties: string[];
  keyTerms: { label: string; value: string }[];
  risks: ContractRisk[];
};

export type ContractValidationReport = {
  droppedParties: number;
  unverifiedExcerpts: number;
  redactedFigures: number;
  strippedCitations: number;
  redactedCitations: number;
};

export function validateContractReview(
  raw: string,
  contractText: string,
  chunks: RetrievedChunk[]
): { ok: true; review: ContractReview; report: ContractValidationReport } | ValidationFailure {
  const json = extractJson(raw);
  if (json === null) return { ok: false, reason: "unparseable", detail: "no JSON object in model output" };
  const parsed = ContractReviewRaw.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "schema", detail: parsed.error.issues[0]?.message ?? "schema mismatch" };
  const r = parsed.data;
  const docNorm = norm(contractText);
  const docDigits = new Set([...normalizeDigits(contractText).matchAll(/\d+/g)].map((m) => m[0]));
  const report: ContractValidationReport = { droppedParties: 0, unverifiedExcerpts: 0, redactedFigures: 0, strippedCitations: 0, redactedCitations: 0 };

  const parties = r.parties.filter((p) => appearsIn(p, docNorm));
  report.droppedParties = r.parties.length - parties.length;

  const fromContract = (text: string) =>
    normalizeDigits(text).replace(/\d+/g, (n) => {
      if (docDigits.has(n)) return n;
      report.redactedFigures++;
      return "[رقم غير مُتحقَّق منه]";
    });

  const keyTerms = r.keyTerms.map((k) => ({ label: k.label.trim(), value: fromContract(k.value.trim()) }));

  const risks: ContractRisk[] = r.risks.map((risk) => {
    const excerptVerified = !risk.excerpt || appearsIn(risk.excerpt, docNorm);
    if (!excerptVerified) report.unverifiedExcerpts++;
    // Explanations may cite a retrieved source; a cited number must match it,
    // and any article/law/decision number WITHOUT a valid citation is redacted.
    const stripped = stripInvalidCitations(risk.explanation, chunks.length);
    report.strippedCitations += stripped.strippedCount;
    let explanation = stripped.text;
    if (/\[\d{1,2}\]/.test(explanation)) {
      const checked = verifyCitedNumbers(explanation, chunks);
      report.redactedCitations += checked.redactedCount;
      explanation = checked.text;
    } else {
      const red = redactCitations(explanation);
      report.redactedCitations += red.redactedCount;
      explanation = red.text;
    }
    return {
      severity: risk.severity,
      title: risk.title.trim(),
      excerpt: excerptVerified ? risk.excerpt.trim() : "",
      explanation: explanation.trim(),
      excerptVerified,
    };
  });

  return { ok: true, review: { summary: fromContract(r.summary.trim()), parties, keyTerms, risks }, report };
}

// ------------------------------------------------------------------ drafts

export type DraftValidationReport = {
  strippedCitations: number;
  redactedCitations: number;
  /** Dates / amounts / id-like numbers the draft stated that the lawyer never supplied. */
  unverifiedFacts: { kind: "date" | "amount" | "number"; value: string }[];
  /** Legal citations in the draft that were verified against a retrieved source. */
  verifiedCitations: number;
};

const DATE_RE = /\b\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}\b|\b\d{4}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{1,2}\b/g;
const AMOUNT_RE = /\d[\d,.]*\s*(?:دينار|دنانير|د\.أ|JD|JOD|فلس)/g;
const LONG_NUMBER_RE = /(?<![\d[])\d{5,}(?![\d\]])/g;

/**
 * Validates a generated draft. `inputs` is everything the lawyer supplied
 * (field values + notes); `chunks` the sources the draft may cite.
 */
export function validateDraft(
  rawDraft: string,
  inputs: string,
  chunks: RetrievedChunk[]
): { ok: true; draft: string; report: DraftValidationReport; groundingLevel: GroundingLevel } | ValidationFailure {
  // The format contract: the document starts at its first "# " line;
  // anything the model wrote before it is commentary, not document.
  const start = rawDraft.search(/^#\s/m);
  if (start === -1) return { ok: false, reason: "schema", detail: "draft has no '# ' header line" };
  let draft = normalizeDigits(rawDraft.slice(start).trim());
  if (draft.length > 30000) return { ok: false, reason: "schema", detail: "draft exceeds 30000 chars" };

  const inputNorm = normalizeDigits(inputs).replace(/\s+/g, "");
  const unverifiedFacts: DraftValidationReport["unverifiedFacts"] = [];
  const supplied = (m: string) =>
    inputNorm.includes(m.replace(/\s+/g, "")) ||
    // A figure inside a cited source's own text (e.g. a statutory amount) is not a client fact.
    chunks.some((c) => normalizeDigits(c.chunk_text).replace(/\s+/g, "").includes(m.replace(/\s+/g, "")));

  // Dates first, set aside behind placeholders: "15/03/2099" otherwise reads
  // to the citation guard as decision number "03/2099".
  const dates: string[] = [];
  draft = draft.replace(DATE_RE, (m) => {
    if (supplied(m)) {
      dates.push(m);
    } else {
      unverifiedFacts.push({ kind: "date", value: m });
      dates.push("[يُستكمل: التاريخ]");
    }
    return `\u2063D${dates.length - 1}\u2063`;
  });

  const stripped = stripInvalidCitations(draft, chunks.length);
  draft = stripped.text;
  const checked = verifyCitedNumbers(draft, chunks);
  draft = checked.text;

  // Any remaining article/law/decision number with no [n] near it is an
  // uncited legal citation — the drafting rules forbid those.
  let redactedUncited = 0;
  draft = draft
    .split("\n")
    .map((line) => {
      if (/\[\d{1,2}\]/.test(line)) return line;
      const red = redactCitations(line);
      redactedUncited += red.redactedCount;
      return red.redactedCount ? red.text.replaceAll("[رقم محجوب — غير مستند إلى قاعدة البيانات]", "[يُستكمل: السند القانوني]") : line;
    })
    .join("\n");

  const replaceUnsupplied = (re: RegExp, kind: "amount" | "number", label: string) => {
    draft = draft.replace(re, (m) => {
      if (supplied(m)) return m;
      unverifiedFacts.push({ kind, value: m });
      return `[يُستكمل: ${label}]`;
    });
  };
  replaceUnsupplied(AMOUNT_RE, "amount", "المبلغ");
  replaceUnsupplied(LONG_NUMBER_RE, "number", "الرقم");
  draft = draft.replace(/\u2063D(\d+)\u2063/g, (_, i) => dates[Number(i)] ?? "");

  const verified = checked.verifiedCount;
  const cites = (draft.match(/\[\d{1,2}\]/g) ?? []).length;
  const groundingLevel: GroundingLevel =
    cites === 0 ? "none" : checked.redactedCount + redactedUncited + stripped.strippedCount === 0 ? "full" : "partial";

  return {
    ok: true,
    draft,
    groundingLevel,
    report: {
      strippedCitations: stripped.strippedCount,
      redactedCitations: checked.redactedCount + redactedUncited,
      unverifiedFacts,
      verifiedCitations: verified,
    },
  };
}
