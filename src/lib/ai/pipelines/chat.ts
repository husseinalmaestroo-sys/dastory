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
import { groundAnswer, type ClaimCheck, type GroundingLevel } from "../grounding";
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

type GroundedText = { text: string; level: GroundingLevel; claims: ClaimCheck[]; stripped: number; redacted: number; verifiedNumbers: number };

/** citation range → article/decision numbers vs cited source → claim-level grounding. */
function checkAnswer(text: string, chunks: RetrievedChunk[], question: string): GroundedText {
  const { text: inRange, strippedCount } = stripInvalidCitations(text, chunks.length);
  const numbers = verifyCitedNumbers(inRange, chunks);
  const g = groundAnswer(numbers.text, chunks, { question });
  return {
    text: g.text,
    level: g.level,
    claims: g.claims,
    stripped: strippedCount + g.counts.strippedCitations,
    redacted: numbers.redactedCount + g.counts.redactedNumbers,
    verifiedNumbers: numbers.verifiedCount,
  };
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
    return shortCircuit(
      english
        ? "The law this question refers to is not in the available legal database, so the article cannot be quoted from a verified source, and no other law's article is substituted for it. Please consult the official text of that law."
        : "القانون الذي يشير إليه السؤال غير موجود في قاعدة البيانات القانونية المتاحة، لذلك لا يمكن تقديم نص المادة المطلوبة من مصدر موثّق، ولن تُستبدل بها مادة من تشريع آخر. راجع النص الرسمي لذلك القانون.",
      "law_not_in_corpus"
    );
  }
  if (search?.requestedArticleMissing) {
    return shortCircuit(
      english
        ? "The requested article number does not appear in the text of that law as held in the database. No other article is offered in its place; please check the article number."
        : "رقم المادة المطلوب غير موجود في نص هذا القانون كما هو محفوظ في قاعدة البيانات، ولن تُعرض مادة أخرى على أنها هي. تحقّق من رقم المادة.",
      "article_not_in_corpus"
    );
  }
  if (search?.requestedDecisionMissing) {
    return shortCircuit(
      english
        ? "The court decision referred to is not in the available database, so its content cannot be reported. No other decision is offered in its place."
        : "القرار القضائي المشار إليه غير موجود في قاعدة البيانات المتاحة، لذلك لا يمكن بيان ما قضى به، ولن يُعرض قرار آخر على أنه هو.",
      "decision_not_in_corpus"
    );
  }
  if (search?.lawNotFound) {
    notices.push(
      "تنبيه: لم يُعثر في قاعدة البيانات على التشريع الذي يذكره السؤال بالاسم؛ المصادر المعروضة أدناه من تشريعات أخرى وقد لا تنطبق عليه."
    );
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
    verification = await verifyAnswer({
      question,
      chunks,
      answer: checked.text,
      citationCheck: { verifiedCount: checked.verifiedNumbers, redactedCount: checked.redacted },
      isRepairAttempt: false,
      knownGaps: gaps,
    });
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
        const repairChecked = checkAnswer(extractGapsAndClean(repairRaw, question).cleaned, chunks, question);
        const second = await verifyAnswer({
          question,
          chunks,
          answer: repairChecked.text,
          citationCheck: { verifiedCount: repairChecked.verifiedNumbers, redactedCount: repairChecked.redacted },
          isRepairAttempt: true,
          knownGaps: gaps,
        });
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
