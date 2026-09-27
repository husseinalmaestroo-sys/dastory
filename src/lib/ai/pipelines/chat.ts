import "server-only";
import { env } from "../../env";
import { logError } from "../../error-log";
import type { Caller } from "../../caller";
import { hybridSearch, type SearchResult } from "../../search/hybrid";
import { analyzeQuery, analyzeQueryRules, type QueryAnalysis } from "../../search/query-understanding";
import { expandQuery } from "../../search/query-expansion";
import { normalizeQuery } from "../../search/normalize";
import { detectComparison } from "../../search/comparison";
import { comparisonSearch } from "../../search/comparison-search";
import type { RetrievedChunk, SearchFilters } from "../../search/types";
import type { ConfidenceResult } from "../../search/confidence";
import { getChatProvider } from "../index";
import {
  buildChatPrompt,
  buildComparisonPrompt,
  buildCondensePrompt,
  buildDirectSourceAnswer,
  buildGapFillPrompt,
  buildGeneralPrompt,
  buildHybridAnalysisPrompt,
  buildRepairPrompt,
  buildStrongGroundingPrompt,
  isRefusal,
  leakReferenceTexts,
  NO_BASIS_ANSWER,
  NO_EVIDENCE_ANSWER_AR,
  NO_EVIDENCE_ANSWER_EN,
  FOREIGN_JURISDICTION_ANSWER_AR,
  FOREIGN_JURISDICTION_ANSWER_EN,
  GENERAL_ANSWER_DISCLAIMER,
  GROUNDED_ANSWER_DISCLAIMER,
  PARTIAL_ANSWER_DISCLAIMER,
  SOURCES_ONLY_DISCLAIMER,
  GAP_MARKER_RE,
  type ConversationTurn,
} from "../prompts";
import { redactCitations, stripInvalidCitations, verifyCitedNumbers } from "../guard";
import { verifyAndCleanCitations } from "../citation-verify";
import { verifyAnswer, type VerificationResult } from "../self-verify";
import { applyClaimVerdicts, capLevel, claimsForJudge, groundAnswer, type ClaimCheck, type ClaimVerdict, type GroundingLevel, type GroundingReport } from "../grounding";
import { extractPremise, premiseConflicts, questionTopicStems, sourceIsRelevant } from "../legal-semantics";
import { normalizeDigits } from "../../ingest/clean";
import { extractAllLawReferences } from "../../search/law-reference";
import { checkJurisdiction, COMPARISON_NOTICE_AR, isMostlyLatin } from "../jurisdiction";
import { detectPromptLeak, PROMPT_LEAK_REPLACEMENT } from "../untrusted";
import type { RequestOutcome } from "../request";

/**
 * THE CHAT PIPELINE (Phase 2 rewrite of /api/chat's inline logic, so the
 * route, the tests and the evaluation harness run the same code).
 *
 *   jurisdiction check → (follow-up condense) → retrieval (+ law scoping,
 *   comparison split, zero-result expansion retry) → deterministic
 *   short-circuits (law not in corpus / ambiguous article / no evidence) →
 *   ONE generation → refusal re-read (once) → gap statements →
 *   citation-number check → CLAIM-LEVEL GROUNDING → self-verification judge
 *   (+ one repair) → prompt-leak check → verified answer.
 *
 * Nothing unverified is streamed: the answer is produced, checked, and only
 * then emitted (the route sends it as one SSE `delta` for the standalone UI,
 * or as JSON for Dostoori). Streaming raw tokens used to put a fabricated
 * article number on screen and take it back a second later — the reader had
 * already read it.
 *
 * Service (Dostoori) callers get the strict profile: no general-knowledge
 * answer, no gap-fill or hybrid supplements (ungrounded model-memory text),
 * and no classifier call whose only consumer is the standalone UI's badge.
 */

export type ChatMode =
  | "grounded"
  | "partial"
  | "sources_only"
  | "no_evidence"
  | "law_not_in_corpus"
  | "article_not_in_corpus"
  | "decision_not_in_corpus"
  | "clarification"
  | "out_of_jurisdiction"
  | "general"
  | "blocked";

export type Citation = {
  ref: number;
  id: number;
  sourceId: number;
  title: string;
  sourceType: string;
  articleNumber: string | null;
  lawName: string | null;
  lawNumber: string | null;
  court: string | null;
  decisionNumber: string | null;
  year: number | null;
  category: string | null;
  excerpt: string;
  score: number;
  matchedBy: string;
  isCurrentVersion: boolean | null;
  effectiveDate: string | null;
  provenance: string | null;
  sourceUrl: string | null;
  /** Whether the final answer cites this source. */
  cited: boolean;
};

export type ChatInput = {
  question: string;
  filters?: SearchFilters;
  history?: ConversationTurn[];
};

export type ChatOutcome = {
  answer: string;
  mode: ChatMode;
  groundingLevel: GroundingLevel;
  /** True only for a grounded or partially grounded answer. */
  grounded: boolean;
  sources: Citation[];
  claims: Pick<ClaimCheck, "text" | "refs" | "kind" | "status" | "issues" | "evidence">[];
  disclaimer?: string;
  confidence: ConfidenceResult | null;
  notices: string[];
  verification: { status: VerificationResult["status"]; passed: boolean; issues: string[]; severity: string; repaired: boolean } | null;
  gapTopics: string[];
  checks: {
    strippedCitations: number;
    redactedNumbers: number;
    removedClaims: number;
    qualifiedClaims: number;
    falseRefusalReread: boolean;
    condensed: boolean;
  };
  /** Standalone-only extras (never produced for service callers). */
  gapFill?: string | null;
  hybridAnalysis?: string | null;
  analysis?: ReturnType<typeof toAnalysisPayload>;
  outcome: RequestOutcome;
};

type Emit = (event: string, data: unknown) => void;

/** Pre-registered marker (eval/dataset.json _heldout) — "تنبيه بشأن مقدمة السؤال". Never echoes what the question asserted. */
export const PREMISE_NOTICE =
  "تنبيه بشأن مقدمة السؤال: ما يفترضه السؤال عن مضمون النص لا يتطابق مع النص كما هو محفوظ في قاعدة البيانات (في رقم أو عقوبة أو حكم)؛ الإجابة أدناه مبنية على النص نفسه لا على ما افترضه السؤال.";
/** Shown when the semantic check (the judge's per-claim verdicts) did not run or did not cover every claim. */
export const SEMANTIC_UNVERIFIED_NOTICE =
  "تنبيه: لم يكتمل التحقق الدلالي الآلي من مطابقة كل جملة لمصدرها؛ راجع النصوص المستشهد بها قبل الاعتماد على الإجابة.";
const LAW_NOT_IN_CORPUS_AR =
  "القانون الذي يشير إليه السؤال غير موجود في قاعدة البيانات القانونية المتاحة، لذلك لا يمكن تقديم نص المادة المطلوبة من مصدر موثّق، ولن تُستبدل بها مادة من تشريع آخر. راجع النص الرسمي لذلك القانون.";
const LAW_NOT_IN_CORPUS_EN =
  "The law this question refers to is not in the available legal database, so the article cannot be quoted from a verified source, and no other law's article is substituted for it. Please consult the official text of that law.";
const LAW_NOT_IN_CORPUS_CONCEPT_AR =
  "القانون الذي يشير إليه السؤال غير موجود في قاعدة البيانات القانونية المتاحة، لذلك لا يمكن الإجابة من نصه، ولن تُستخدم نصوص تشريعات أخرى بديلاً عنه. راجع النص الرسمي لذلك القانون.";
const LAW_NOT_IN_CORPUS_CONCEPT_EN =
  "The law this question refers to is not in the available legal database, so the question cannot be answered from its text, and other laws are not used in its place. Please consult the official text of that law.";
/** Phase 2.1: the question cites an article the law does not have, but asks more than its text. */
export const ARTICLE_MISSING_NOTICE_AR =
  "تنبيه: رقم المادة المذكور في السؤال غير موجود في نص هذا القانون كما هو محفوظ في قاعدة البيانات؛ الإجابة أدناه من المواد الموجودة فعلاً، ولا يُنسب إلى ذلك الرقم شيء.";
const ARTICLE_MISSING_NOTICE_EN =
  "Notice: the article number cited in the question does not exist in that law as held in the database; the answer below is from the articles that do exist, and nothing is attributed to that number.";
/** Phase 2.1: the question cited a law by a number/year that belongs to a superseded version. */
export const CITED_SUPERSEDED_AR =
  "تنبيه: رقم القانون وسنته كما وردا في السؤال يشيران إلى نص سابق غير نافذ حالياً؛ الإجابة من ذلك النص كما طُلب، وهي لا تمثّل النص النافذ.";
const CITED_SUPERSEDED_EN =
  "Notice: the law number/year cited in the question belong to a previous text that is no longer in force; the answer is from that text, as asked, and does not state the law in force.";
/** Phase 2.1: the named law is in the corpus, but no version of it carries the cited number/year. */
export const CITATION_MISMATCH_AR =
  "تنبيه: رقم القانون أو سنته كما وردا في السؤال لا يطابقان أي نسخة من هذا القانون في قاعدة البيانات؛ الإجابة من نص القانون المسمّى كما هو محفوظ فيها.";
const CITATION_MISMATCH_EN =
  "Notice: the law number or year cited in the question does not match any version of that law in the database; the answer is from the named law's text as held there.";

// ---------------------------------------------------------------- helpers

// Instruction-like text a condensed rewrite may not introduce on its own.
const INJECTION_MARKERS =
  /تجاهل|تعليمات|النظام|system|ignore|instruction|prompt|reveal|اكشف|أفصح|افصح|<<<|>>>|assistant|المساعد/i;

/**
 * Accepts the rewrite only if it is question-sized, one paragraph, and adds
 * no instruction-like text the lawyer's own follow-up did not contain. The
 * history is untrusted (a forged "assistant" turn is just text); this bounds
 * what it can smuggle into the one string that reaches retrieval and the
 * answer prompt.
 */
export function acceptCondensed(rawQuestion: string, rewritten: string): boolean {
  if (!rewritten || rewritten.length > 600 || rewritten.includes("\n\n")) return false;
  const newMarkers = [...rewritten.matchAll(new RegExp(INJECTION_MARKERS.source, "gi"))].filter(
    (m) => !rawQuestion.toLowerCase().includes(m[0].toLowerCase())
  );
  return newMarkers.length === 0;
}

async function condenseFollowUp(history: ConversationTurn[], rawQuestion: string): Promise<string> {
  if (history.length === 0) return rawQuestion;
  try {
    const { system, user } = buildCondensePrompt(history, rawQuestion);
    const res = await getChatProvider().chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { maxTokens: 200, purpose: "condense" }
    );
    const rewritten = res.text.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
    return acceptCondensed(rawQuestion, rewritten) ? rewritten : rawQuestion;
  } catch (err) {
    logError("[chat] follow-up condense failed — using the question as-is:", err);
    return rawQuestion;
  }
}

const ESCAPED_NO_BASIS = NO_BASIS_ANSWER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pulls gap topics out of a grounded answer ([فجوة: ...] markers, or the
 * reserved refusal sentence reused mid-answer) and returns the text with
 * every trace of them removed.
 */
export function extractGapsAndClean(answer: string, question: string): { gaps: string[]; cleaned: string } {
  const gaps = [...answer.matchAll(GAP_MARKER_RE)].map((m) => m[1].trim());
  let cleaned = answer.replace(GAP_MARKER_RE, "").replace(/[ \t]{2,}/g, " ");

  if (gaps.length === 0 && cleaned.includes(NO_BASIS_ANSWER)) {
    const clauseRe = new RegExp(`[^.\\n]*${ESCAPED_NO_BASIS}\\.?`, "g");
    cleaned = cleaned.replace(clauseRe, (clause) => {
      const topic = clause
        .replace(new RegExp(`${ESCAPED_NO_BASIS}\\.?`), "")
        .replace(/^[\s,،]*(?:و)?\s*(?:أما\s+)?(?:بالنسبة\s+ل|بخصوص|عن)\s*/, "")
        .replace(/[\s,،]*(?:ف(?:إنه|ـ)?)?\s*$/, "")
        .trim();
      gaps.push(topic.length >= 4 ? topic : question);
      return "";
    });
  }
  return { gaps, cleaned: cleaned.replace(/[ \t]{2,}/g, " ").trim() };
}

export function toAnalysisPayload(a: QueryAnalysis, expandedWith: string[] = []) {
  return {
    queryType: a.queryType,
    legalArea: a.legalArea,
    expectedLaw: a.expectedLaw,
    legalConcepts: a.legalConcepts,
    needsExpansion: a.needsExpansion,
    method: a.method,
    expandedWith,
  };
}

/** What a client needs to render (and trace) a source — never the full chunk body. */
export function toCitation(c: RetrievedChunk, i: number, cited = false): Citation {
  return {
    ref: i + 1,
    id: Number(c.id),
    sourceId: Number(c.source_id),
    title: c.source_title,
    sourceType: c.source_type,
    articleNumber: c.article_number,
    lawName: c.law_name,
    lawNumber: c.law_number,
    court: c.court,
    decisionNumber: c.decision_number,
    year: c.year,
    category: c.category,
    excerpt: c.chunk_text.slice(0, 400),
    score: Number(c.score.toFixed(4)),
    matchedBy: c.matched_by,
    isCurrentVersion: c.is_current_version ?? null,
    effectiveDate: c.effective_date ?? null,
    provenance: c.provenance ?? null,
    sourceUrl: c.source_url ?? null,
    cited,
  };
}

function citedRefs(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
}

const MAX_GAP_TOPIC = 160;

function gapStatement(gaps: string[]): string {
  const topics = gaps
    .map((g) => redactCitations(g).text.replace(/\s+/g, " ").trim().slice(0, MAX_GAP_TOPIC))
    .filter(Boolean);
  if (topics.length === 0) return "";
  return `حدود الإجابة: لم تتضمن المصادر المتاحة ما يجيب عن: ${topics.join("؛ ")}.`;
}

function trimClaims(claims: ClaimCheck[]): ChatOutcome["claims"] {
  return claims.slice(0, 40).map((c) => ({
    text: c.text.slice(0, 500),
    refs: c.refs,
    kind: c.kind,
    status: c.status,
    issues: c.issues,
    evidence: c.evidence,
  }));
}

type GroundedText = {
  text: string;
  level: GroundingLevel;
  claims: ClaimCheck[];
  stripped: number;
  redacted: number;
  verifiedNumbers: number;
  report: GroundingReport;
};

function fromReport(report: GroundingReport, base: Omit<GroundedText, "text" | "level" | "claims" | "report">): GroundedText {
  return { ...base, text: report.text, level: report.level, claims: report.claims, report };
}

/** citation range → article/decision numbers vs cited source → claim-level grounding (incl. relevance to the question). */
function checkAnswer(text: string, chunks: RetrievedChunk[], question: string): GroundedText {
  const { text: inRange, strippedCount } = stripInvalidCitations(text, chunks.length);
  const numbers = verifyCitedNumbers(inRange, chunks);
  // Sources relevant by construction: the article asked for, and one a relevant article refers to.
  const exactRefs = new Set(chunks.flatMap((c, i) => (c.exact_hit || c.companion_of ? [i + 1] : [])));
  const g = groundAnswer(numbers.text, chunks, { question, exactRefs });
  return fromReport(g, {
    stripped: strippedCount + g.counts.strippedCitations,
    redacted: numbers.redactedCount + g.counts.redactedNumbers,
    verifiedNumbers: numbers.verifiedCount,
  });
}

/** Numbers the judge's per-claim verdicts refer to ↔ indices of the claims in the report. */
function judgeClaimsOf(checked: GroundedText): { n: number; index: number; text: string; refs: number[] }[] {
  return claimsForJudge(checked.report).map((c, i) => ({ ...c, n: i + 1 }));
}

function withVerdicts(checked: GroundedText, judged: { n: number; index: number }[], v: VerificationResult | null): GroundedText {
  if (!v || v.status !== "ok" || v.claimVerdicts.size === 0) return checked;
  const byIndex = new Map<number, ClaimVerdict>();
  for (const j of judged) {
    const verdict = v.claimVerdicts.get(j.n);
    if (verdict) byIndex.set(j.index, verdict);
  }
  return fromReport(applyClaimVerdicts(checked.report, byIndex), checked);
}

/**
 * What the question asserts about a source ("بما أن المادة 20 … ستين يوماً")
 * checked against that source: the exact article it names, else the sources
 * the answer cites. True when every such source contradicts it.
 */
function premiseContradicted(question: string, chunks: RetrievedChunk[], citedRefs: Set<number>): boolean {
  const premise = extractPremise(question);
  if (!premise) return false;
  const aboutSource = /ماد[ةه]\s*\(?\s*\d+/.test(normalizeDigits(premise)) || extractAllLawReferences(premise).length > 0;
  if (!aboutSource) return false; // a statement of the case's facts, not of the law
  const articles = [...normalizeDigits(premise).matchAll(/ماد[ةه]\s*\(?\s*(\d+)/g)].map((m) => m[1]);
  let targets = articles.length ? chunks.filter((c) => c.exact_hit && c.article_number && articles.includes(normalizeDigits(c.article_number))) : [];
  if (targets.length === 0) targets = chunks.filter((_, i) => citedRefs.has(i + 1));
  if (targets.length === 0) return false;
  return targets.every((c) => {
    const meta = new Set(
      [c.article_number, c.law_number, c.year, c.decision_number]
        .flatMap((x) => (x === null || x === undefined ? [] : [...normalizeDigits(String(x)).matchAll(/\d+/g)].map((m) => Number(m[0]))))
    );
    return premiseConflicts(premise, c.chunk_text, meta).length > 0;
  });
}

// ---------------------------------------------------------------- pipeline

export async function runChatPipeline(input: ChatInput, caller: Caller, emit: Emit = () => {}): Promise<ChatOutcome> {
  const strict = caller.kind === "service";
  const filters = input.filters ?? {};
  const english = isMostlyLatin(input.question);
  const notices: string[] = [];
  const checks: ChatOutcome["checks"] = {
    strippedCitations: 0,
    redactedNumbers: 0,
    removedClaims: 0,
    qualifiedClaims: 0,
    falseRefusalReread: false,
    condensed: false,
  };

  const finish = (o: Omit<ChatOutcome, "notices" | "checks" | "outcome">, retrievalCount: number): ChatOutcome => ({
    ...o,
    notices,
    checks,
    outcome: {
      success: true,
      outcome: o.mode,
      groundingLevel: o.groundingLevel,
      retrievalCount,
      sourceCount: o.sources.filter((s) => s.cited).length,
    },
  });
  const fixedAnswer = (answer: string, mode: ChatMode): ChatOutcome =>
    finish({ answer, mode, groundingLevel: "none", grounded: false, sources: [], claims: [], confidence: null, verification: null, gapTopics: [] }, 0);

  // 1. Jurisdiction: a question about another country's law is not answered
  //    from Jordanian sources as if they applied, nor from memory.
  let juris = checkJurisdiction(input.question);
  if (juris.kind === "foreign") return fixedAnswer(english ? FOREIGN_JURISDICTION_ANSWER_EN : FOREIGN_JURISDICTION_ANSWER_AR, "out_of_jurisdiction");

  // 2. Follow-up rewrite (history is data; see acceptCondensed).
  const condensed = await condenseFollowUp(input.history ?? [], input.question);
  checks.condensed = condensed !== input.question;
  if (checks.condensed) {
    juris = checkJurisdiction(condensed);
    if (juris.kind === "foreign") return fixedAnswer(english ? FOREIGN_JURISDICTION_ANSWER_EN : FOREIGN_JURISDICTION_ANSWER_AR, "out_of_jurisdiction");
  }
  if (juris.kind === "comparison") notices.push(COMPARISON_NOTICE_AR);
  const question = normalizeQuery(condensed);

  // 3. Retrieval.
  const rules = analyzeQueryRules(question);
  const comparison = detectComparison(question);
  // The LLM classifier only feeds the standalone UI's badge — never paid for on service calls.
  const analysisPromise = strict ? Promise.resolve(rules) : analyzeQuery(question);

  let chunks: RetrievedChunk[];
  let confidence: ConfidenceResult;
  let addedTerms: string[] = [];
  let chunksA: RetrievedChunk[] = [];
  let chunksB: RetrievedChunk[] = [];
  let search: SearchResult | null = null;

  if (comparison) {
    const ctx = { queryType: rules.queryType, legalArea: rules.legalArea };
    let cmp = await comparisonSearch(question, comparison.sideA, comparison.sideB, filters, env.topK, ctx);
    if (cmp.chunks.length === 0 && env.legalQueryExpansion && env.queryLlmFallback) {
      const retry = await comparisonSearch(question, comparison.sideA, comparison.sideB, filters, env.topK, ctx, { allowLLM: true });
      if (retry.chunks.length > 0) cmp = retry;
    }
    ({ chunks, chunksA, chunksB, confidence, addedTerms } = cmp);
  } else {
    const expansion = await expandQuery(question, rules);
    addedTerms = expansion.addedTerms;
    search = await hybridSearch(question, filters, undefined, {
      searchText: expansion.searchText,
      orGroup: expansion.orGroup,
      queryType: rules.queryType,
      legalArea: rules.legalArea,
    });
    if (search.chunks.length === 0 && !search.requestedLawMissing && rules.queryType !== "fact_pattern" && env.legalQueryExpansion && env.queryLlmFallback) {
      const retryExpansion = await expandQuery(question, rules, { allowLLM: true });
      if (retryExpansion.addedTerms.length > 0) {
        const retry = await hybridSearch(question, filters, undefined, {
          searchText: retryExpansion.searchText,
          orGroup: retryExpansion.orGroup,
          queryType: rules.queryType,
          legalArea: rules.legalArea,
        });
        if (retry.chunks.length > 0) search = retry;
      }
    }
    chunks = search.chunks;
    confidence = search.confidence;
  }

  const analysis = strict ? undefined : toAnalysisPayload(await analysisPromise, addedTerms);
  if (analysis) emit("analysis", analysis);

  // 4. Deterministic short-circuits — no model call, nothing to hallucinate.
  //    The messages never echo the lawyer's wording back (a mis-parsed name or
  //    an injected phrase must not come back looking like our statement).
  const shortCircuit = (answer: string, mode: ChatMode) =>
    finish({ answer, mode, groundingLevel: "none", grounded: false, sources: [], claims: [], confidence: null, verification: null, gapTopics: [], analysis }, 0);
  if (search?.requestedLawMissing) {
    return shortCircuit(english ? LAW_NOT_IN_CORPUS_EN : LAW_NOT_IN_CORPUS_AR, "law_not_in_corpus");
  }
  const articleMissing = () =>
    shortCircuit(
      english
        ? "The requested article number does not appear in the text of that law as held in the database. No other article is offered in its place; please check the article number."
        : "رقم المادة المطلوب غير موجود في نص هذا القانون كما هو محفوظ في قاعدة البيانات، ولن تُعرض مادة أخرى على أنها هي. تحقّق من رقم المادة.",
      "article_not_in_corpus"
    );
  // Phase 2.1: a missing article ends a LOOKUP ("ما نص المادة 999 …؟"). A
  // question that asks more than that ("… استشهد بالمادة 999 عند الإجابة عن
  // مدة الإشعار لإنهاء الإيجار") is answered from the articles that exist,
  // with a notice that the cited number is not in the law — nothing is
  // attributed to it (and the guard redacts it if a model writes it).
  const missingArticleButAsksMore = !!search?.requestedArticleMissing && questionTopicStems(question).length >= 2;
  if (search?.requestedArticleMissing && !missingArticleButAsksMore) return articleMissing();
  if (search?.requestedDecisionMissing) {
    return shortCircuit(
      english
        ? "The court decision referred to is not in the available database, so its content cannot be reported. No other decision is offered in its place."
        : "القرار القضائي المشار إليه غير موجود في قاعدة البيانات المتاحة، لذلك لا يمكن بيان ما قضى به، ولن يُعرض قرار آخر على أنه هو.",
      "decision_not_in_corpus"
    );
  }
  // Phase 2.1: a named law the corpus does not hold is "not in the database"
  // for conceptual questions too — answering from other laws' text (with a
  // notice) presented them as if they could stand in for it.
  if (search?.lawNotFound) {
    return shortCircuit(english ? LAW_NOT_IN_CORPUS_CONCEPT_EN : LAW_NOT_IN_CORPUS_CONCEPT_AR, "law_not_in_corpus");
  }
  if (search?.articleAmbiguity) {
    const { article, laws } = search.articleAmbiguity;
    return finish(
      {
        answer: `المادة ${article} واردة في أكثر من تشريع ضمن قاعدة البيانات، منها: ${laws.join("، ")}. حدّد التشريع المقصود لأجيبك من نصه.`,
        mode: "clarification",
        groundingLevel: "none",
        grounded: false,
        sources: [],
        claims: [],
        confidence: null,
        verification: null,
        gapTopics: [],
        analysis,
      },
      chunks.length
    );
  }

  // Phase 2.1: what the lawyer's own citation of the law's number/year told
  // retrieval — a superseded version was asked for (and searched), or the
  // number/year matches no version of the named law.
  if (search?.citedVersion && !search.citedVersion.current) notices.push(english ? CITED_SUPERSEDED_EN : CITED_SUPERSEDED_AR);
  if (search?.citationMismatch) notices.push(english ? CITATION_MISMATCH_EN : CITATION_MISMATCH_AR);

  // Phase 2.1: a source that does not bear on the question (no shared subject
  // matter; a short-title/commencement article) is never handed to the model
  // as evidence — grounding would reject any answer built on it anyway.
  // An article carried because a relevant one refers to it (companion_of) is relevant through it.
  chunks = chunks.filter((c) => sourceIsRelevant(question, c, { exactHit: c.exact_hit || !!c.companion_of }));
  if (missingArticleButAsksMore) {
    if (chunks.length === 0) return articleMissing();
    notices.push(english ? ARTICLE_MISSING_NOTICE_EN : ARTICLE_MISSING_NOTICE_AR);
  }

  if (chunks.length === 0) {
    // Opt-in general-knowledge orientation — standalone only, never Dostoori.
    if (!strict && env.allowGeneralFallback) {
      const { system, user } = buildGeneralPrompt(question);
      try {
        const res = await getChatProvider().chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { maxTokens: 1200, purpose: "general" }
        );
        const { text } = redactCitations(redactFigures(res.text));
        if (detectPromptLeak(text, leakReferenceTexts())) return fixedAnswer(PROMPT_LEAK_REPLACEMENT, "blocked");
        return finish(
          { answer: text, mode: "general", groundingLevel: "none", grounded: false, sources: [], claims: [], disclaimer: GENERAL_ANSWER_DISCLAIMER, confidence: null, verification: null, gapTopics: [], analysis },
          0
        );
      } catch (err) {
        logError("[chat] general answer failed:", err);
      }
    }
    return finish(
      { answer: english ? NO_EVIDENCE_ANSWER_EN : NO_EVIDENCE_ANSWER_AR, mode: "no_evidence", groundingLevel: "none", grounded: false, sources: [], claims: [], confidence: null, verification: null, gapTopics: [], analysis },
      0
    );
  }

  const retrieval = chunks.length;
  emit("sources", chunks.map((c, i) => toCitation(c, i)));

  // 5. One generation.
  const provider = getChatProvider();
  const { system, user } = comparison
    ? buildComparisonPrompt(question, comparison.sideA, comparison.sideB, chunks, chunksA, chunksB)
    : buildChatPrompt(question, chunks);

  // Standalone-only hybrid supplement, started in parallel (opt-in).
  const hybridPromise =
    !strict && env.hybridFallback && confidence.label === "منخفضة"
      ? (() => {
          const h = buildHybridAnalysisPrompt(question, chunks);
          return provider
            .chat(
              [
                { role: "system", content: h.system },
                { role: "user", content: h.user },
              ],
              { maxTokens: 700, purpose: "hybrid" }
            )
            .catch((err) => {
              logError("[chat] hybrid analysis failed:", err);
              return null;
            });
        })()
      : null;

  let raw: string;
  try {
    raw = (
      await provider.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens: 1500, purpose: "answer" }
      )
    ).text;
  } catch (err) {
    logError("[chat] generation failed — showing the retrieved sources instead:", err);
    return sourcesOnly();
  }

  // 6. A refusal although sources exist: one careful re-read, which may
  //    still conclude that the sources are insufficient.
  if (isRefusal(raw)) {
    checks.falseRefusalReread = true;
    try {
      const fg = buildStrongGroundingPrompt(question, chunks);
      raw = (
        await provider.chat(
          [
            { role: "system", content: fg.system },
            { role: "user", content: fg.user },
          ],
          { maxTokens: 1200, purpose: "reread" }
        )
      ).text;
    } catch (err) {
      logError("[chat] re-read failed:", err);
      return sourcesOnly();
    }
    if (isRefusal(raw)) {
      return finish(
        { answer: english ? NO_EVIDENCE_ANSWER_EN : NO_EVIDENCE_ANSWER_AR, mode: "no_evidence", groundingLevel: "none", grounded: false, sources: [], claims: [], confidence, verification: null, gapTopics: [], analysis },
        retrieval
      );
    }
  }

  // 7. Gaps → explicit limitation statements; then verify the text.
  const { gaps, cleaned } = extractGapsAndClean(raw, question);
  let checked = checkAnswer(cleaned, chunks, question);

  // 8. Second opinion (LLM judge) + at most one repair.
  let verification: VerificationResult | null = null;
  let repaired = false;
  if (env.selfVerification && checked.level !== "none") {
    const judged = judgeClaimsOf(checked);
    verification = await verifyAnswer({
      question,
      chunks,
      answer: checked.text,
      citationCheck: { verifiedCount: checked.verifiedNumbers, redactedCount: checked.redacted },
      isRepairAttempt: false,
      knownGaps: gaps,
      claims: judged.map(({ n, text, refs }) => ({ n, text, refs })),
    });
    checked = withVerdicts(checked, judged, verification);
    if (verification.action === "regenerate") {
      try {
        const rp = buildRepairPrompt(question, chunks, checked.text, verification.issues);
        const repairRaw = (
          await provider.chat(
            [
              { role: "system", content: rp.system },
              { role: "user", content: rp.user },
            ],
            { maxTokens: 1200, purpose: "repair" }
          )
        ).text;
        let repairChecked = checkAnswer(extractGapsAndClean(repairRaw, question).cleaned, chunks, question);
        const repairJudged = judgeClaimsOf(repairChecked);
        const second = await verifyAnswer({
          question,
          chunks,
          answer: repairChecked.text,
          citationCheck: { verifiedCount: repairChecked.verifiedNumbers, redactedCount: repairChecked.redacted },
          isRepairAttempt: true,
          knownGaps: gaps,
          claims: repairJudged.map(({ n, text, refs }) => ({ n, text, refs })),
        });
        repairChecked = withVerdicts(repairChecked, repairJudged, second);
        repaired = true;
        verification = second;
        if (second.action === "return" && repairChecked.level !== "none") {
          checked = repairChecked;
        } else {
          return sourcesOnly(verification, repaired);
        }
      } catch (err) {
        logError("[chat] repair generation failed:", err);
      }
    }
  }

  if (checked.level === "none") return sourcesOnly(verification, repaired);

  // "full" means every claim passed the deterministic checks AND the semantic
  // judge ruled on every one of them. Without that second check (disabled,
  // failed, or a claim left unjudged) the answer is at most "partial".
  const semanticallyVerified = env.selfVerification && verification?.status === "ok" && verification.claimsJudged;
  if (!semanticallyVerified && checked.level === "full") {
    checked = { ...checked, level: capLevel(checked.level, "partial") };
    notices.push(SEMANTIC_UNVERIFIED_NOTICE);
  }

  if (premiseContradicted(question, chunks, citedRefs(checked.text))) notices.push(PREMISE_NOTICE);

  checks.strippedCitations += checked.stripped;
  checks.redactedNumbers += checked.redacted;
  checks.removedClaims += checked.claims.filter((c) => c.status === "removed").length;
  checks.qualifiedClaims += checked.claims.filter((c) => c.status === "qualified").length;

  let answer = [checked.text, gapStatement(gaps)].filter(Boolean).join("\n\n");

  // 9. Output must never carry the system prompt.
  if (detectPromptLeak(answer, leakReferenceTexts())) {
    logError("[chat] blocked an answer that reproduced system instructions", null);
    return fixedAnswer(PROMPT_LEAK_REPLACEMENT, "blocked");
  }

  // Standalone-only supplements.
  let gapFill: string | null = null;
  let hybridAnalysis: string | null = null;
  if (!strict && env.gapFillEnabled && gaps.length > 0) {
    try {
      const gp = buildGapFillPrompt(question, gaps);
      const res = await provider.chat(
        [
          { role: "system", content: gp.system },
          { role: "user", content: gp.user },
        ],
        { maxTokens: 600, purpose: "gapfill" }
      );
      gapFill = redactCitations(redactFigures(res.text)).text;
    } catch (err) {
      logError("[chat] gap-fill failed:", err);
    }
  }
  if (hybridPromise) {
    const res = await hybridPromise;
    if (res) hybridAnalysis = (await verifyAndCleanCitations(redactFigures(res.text))).text;
  }

  if (notices.length) answer = `${notices.join("\n")}\n\n${answer}`;
  const refs = citedRefs(answer);
  const level = checked.level;
  return finish(
    {
      answer,
      mode: level === "full" ? "grounded" : "partial",
      groundingLevel: level,
      grounded: true,
      sources: chunks.map((c, i) => toCitation(c, i, refs.has(i + 1))),
      claims: trimClaims(checked.claims),
      disclaimer: level === "full" ? GROUNDED_ANSWER_DISCLAIMER : PARTIAL_ANSWER_DISCLAIMER,
      confidence,
      verification: verification
        ? { status: verification.status, passed: verification.passed, issues: verification.issues, severity: verification.severity, repaired }
        : null,
      gapTopics: gaps,
      gapFill,
      hybridAnalysis,
      analysis,
    },
    retrieval
  );

  function sourcesOnly(v: VerificationResult | null = null, rep = false): ChatOutcome {
    const text = buildDirectSourceAnswer(chunks);
    if (premiseContradicted(question, chunks, new Set(chunks.map((_, i) => i + 1)))) notices.push(PREMISE_NOTICE);
    return finish(
      {
        answer: text,
        mode: "sources_only",
        groundingLevel: "none",
        grounded: false,
        sources: chunks.map((c, i) => toCitation(c, i, true)),
        claims: [],
        disclaimer: SOURCES_ONLY_DISCLAIMER,
        confidence,
        verification: v ? { status: v.status, passed: v.passed, issues: v.issues, severity: v.severity, repaired: rep } : null,
        gapTopics: [],
        analysis,
      },
      chunks.length
    );
  }
}

/**
 * Ungrounded text (general / gap-fill / hybrid supplements) may not state
 * figures: durations, amounts and penalties are exactly what a model
 * "remembers" wrongly. Every standalone number is replaced.
 */
export function redactFigures(text: string): string {
  return text.replace(/(?<![\p{L}\d])[\d٠-٩۰-۹]+(?:[.,][\d٠-٩۰-۹]+)?(?![\p{L}\d])/gu, "[رقم محجوب]");
}
