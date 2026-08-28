/**
 * Full-pipeline (non-streaming) reproduction of route.ts's generation logic,
 * for end-to-end before/after testing without needing lawyer auth/SSE
 * plumbing. Mirrors route.ts's actual sequence: retrieval → prompt → generate
 * → false-refusal retry → direct-source fallback → citation checks →
 * self-verify — using the SAME functions route.ts calls (prompts.ts,
 * guard.ts, self-verify.ts), not a re-implementation, so behavior here is
 * what the real endpoint does.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-e2e-test.ts [--mode=before|after] [--only=N]
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { detectComparison } from "../src/lib/search/comparison";
import { comparisonSearch } from "../src/lib/search/comparison-search";
import { getChatProvider } from "../src/lib/ai";
import {
  buildChatPrompt,
  buildComparisonPrompt,
  buildStrongGroundingPrompt,
  buildDirectSourceAnswer,
  isRefusal,
  NO_BASIS_ANSWER,
  GAP_MARKER_RE,
} from "../src/lib/ai/prompts";
import { stripInvalidCitations, verifyCitedNumbers } from "../src/lib/ai/guard";
import { verifyAnswer, extractCitedIndices } from "../src/lib/ai/self-verify";
import type { RetrievedChunk } from "../src/lib/search/types";

const QUESTIONS = [
  // #1 — the exact reported failure.
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟",
  "ما الفرق بين العقد الباطل والعقد القابل للإبطال؟",
  "ما هي أركان جريمة الاحتيال؟",
  "ما هي شروط اكتساب صفة التاجر؟",
  "ما الفرق بين القرض والوديعة وأثر ذلك على المسؤولية الجزائية؟",
  "ما الفرق بين الفصل التعسفي والفصل المشروع؟",
  "ما هي شروط بطلان حكم التحكيم؟",
  "ما الفرق بين المسؤولية العقدية والمسؤولية التقصيرية؟",
  "ما هي أسباب الإباحة وموانع المسؤولية؟",
  // #10 — a question whose correct legal source is absent from this corpus
  // (a real foreign-law topic no Jordanian source could ever answer).
  "ما هي شروط الطلاق البائن في القانون الإماراتي؟",
];

type CaseReport = {
  question: string;
  mode: string;
  retrieval: { n: number; nA?: number; nB?: number; confidence: string; confidenceScore: number };
  firstAttemptRefused: boolean;
  falseRefusalRecovered: boolean;
  usedDirectSourceFallback: boolean;
  finalMode: "refused" | "grounded" | "grounded_retry" | "no_sources";
  answerPreview: string;
  /** Distinct [n] reference markers actually in the answer text (extractCitedIndices) — the real "did it cite" signal. */
  citationRefs: number;
  /** Out-of-range [n] refs stripped (stripInvalidCitations) — should always be 0. */
  citationsOutOfRange: number;
  /** Article/decision numbers written OUT IN PROSE near a [n] marker that didn't match that chunk's own metadata — a narrower, rarer signal than citationRefs (guard.ts's verifyCitedNumbers); most answers cite via bare [n] with no restated number at all, so 0/0 here is normal, not a defect. */
  proseNumbersVerified: number;
  proseNumbersRedacted: number;
  hallucinatedArticleRefs: number;
  verification: { issues: string[]; severity: string } | null;
  latencyMs: number;
  fullAnswer?: string;
};

/** Article numbers the answer asserts in prose that don't appear in ANY retrieved chunk's own article_number or body text — the real hallucination signal, independent of whether a [n] marker sits nearby. */
function hallucinatedArticles(answer: string, chunks: RetrievedChunk[]): number {
  const grounded = new Set<string>();
  for (const c of chunks) {
    if (c.article_number) grounded.add(c.article_number.replace(/\D/g, ""));
    for (const m of c.chunk_text.matchAll(/(?:ال)?ماد[ةه]\s*[({[]?\s*(\d{1,4})/g)) grounded.add(m[1]);
  }
  const cited = [...answer.matchAll(/(?:ال)?ماد[ةه]\s*[({[]?\s*(\d{1,4})/g)].map((m) => m[1]);
  return cited.filter((a) => !grounded.has(a)).length;
}

async function runOne(question: string, mode: "before" | "after"): Promise<CaseReport> {
  const started = Date.now();
  const q = normalizeQuery(question);
  const rules = analyzeQueryRules(q);
  const comparison = mode === "after" ? detectComparison(q) : null;

  let chunks: RetrievedChunk[];
  let chunksA: RetrievedChunk[] = [];
  let chunksB: RetrievedChunk[] = [];
  let confidenceLabel = "";
  let confidenceScore = 0;

  if (comparison) {
    const r = await comparisonSearch(q, comparison.sideA, comparison.sideB, {}, 8, {
      queryType: rules.queryType,
      legalArea: rules.legalArea,
    });
    chunks = r.chunks;
    chunksA = r.chunksA;
    chunksB = r.chunksB;
    confidenceLabel = r.confidence.label;
    confidenceScore = r.confidence.score;
  } else {
    const expansion = await expandQuery(q, rules, { allowLLM: false });
    const r = await hybridSearch(q, {}, 8, {
      searchText: expansion.searchText,
      orGroup: expansion.orGroup,
      queryType: rules.queryType,
      legalArea: rules.legalArea,
    });
    chunks = r.chunks;
    confidenceLabel = r.confidence.label;
    confidenceScore = r.confidence.score;
  }

  if (chunks.length === 0) {
    return {
      question,
      mode,
      retrieval: { n: 0, confidence: confidenceLabel, confidenceScore },
      firstAttemptRefused: true,
      falseRefusalRecovered: false,
      usedDirectSourceFallback: false,
      finalMode: "no_sources",
      answerPreview: "(لا مصادر — يتوقع الرفض/التوجيه العام)",
      citationRefs: 0,
      citationsOutOfRange: 0,
      proseNumbersVerified: 0,
      proseNumbersRedacted: 0,
      hallucinatedArticleRefs: 0,
      verification: null,
      latencyMs: Date.now() - started,
    };
  }

  const provider = getChatProvider();
  const { system, user } = comparison
    ? buildComparisonPrompt(q, comparison.sideA, comparison.sideB, chunks, chunksA, chunksB)
    : buildChatPrompt(q, chunks);

  const first = await provider.chat([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 1200 });
  let answer = first.text;
  let grounded = !isRefusal(answer);
  let falseRefusalRecovered = false;
  let usedDirectSourceFallback = false;

  if (!grounded) {
    falseRefusalRecovered = true;
    const { system: fgSystem, user: fgUser } = buildStrongGroundingPrompt(q, chunks);
    const retry = await provider.chat([{ role: "system", content: fgSystem }, { role: "user", content: fgUser }], { maxTokens: 1200 });
    if (!isRefusal(retry.text)) {
      answer = retry.text;
      grounded = true;
    } else {
      answer = buildDirectSourceAnswer(chunks);
      grounded = true;
      usedDirectSourceFallback = true;
    }
  }

  let citationRefs = 0;
  let citationsOutOfRange = 0;
  let proseNumbersVerified = 0;
  let proseNumbersRedacted = 0;
  let verification: { issues: string[]; severity: string } | null = null;

  if (grounded && !usedDirectSourceFallback) {
    // Same as route.ts's extractGapsAndClean: pull [فجوة: ...] markers out
    // before anything downstream sees them, and tell the judge about them —
    // an honestly-disclosed gap is not an incompleteness DEFECT, and the
    // judge has no way to know that unless told.
    const gaps = [...answer.matchAll(GAP_MARKER_RE)].map((m) => m[1].trim());
    const degapped = answer.replace(GAP_MARKER_RE, "").replace(/[ \t]{2,}/g, " ").trim();

    const { text: stripped, strippedCount } = stripInvalidCitations(degapped, chunks.length);
    citationsOutOfRange = strippedCount;
    const verified = verifyCitedNumbers(stripped, chunks);
    answer = verified.text;
    proseNumbersVerified = verified.verifiedCount;
    proseNumbersRedacted = verified.redactedCount;
    citationRefs = extractCitedIndices(answer).length;

    const v = await verifyAnswer({
      question: q,
      chunks,
      answer,
      citationCheck: { verifiedCount: verified.verifiedCount, redactedCount: verified.redactedCount },
      isRepairAttempt: false,
      knownGaps: gaps,
    });
    verification = { issues: v.issues, severity: v.severity };
  }

  const finalMode = !grounded ? "refused" : falseRefusalRecovered ? "grounded_retry" : "grounded";

  return {
    question,
    mode,
    retrieval: { n: chunks.length, nA: chunksA.length || undefined, nB: chunksB.length || undefined, confidence: confidenceLabel, confidenceScore },
    firstAttemptRefused: !grounded && !falseRefusalRecovered ? false : falseRefusalRecovered,
    falseRefusalRecovered,
    usedDirectSourceFallback,
    finalMode,
    answerPreview: answer.replace(/\s+/g, " ").slice(0, 350),
    citationRefs,
    citationsOutOfRange,
    proseNumbersVerified,
    proseNumbersRedacted,
    hallucinatedArticleRefs: usedDirectSourceFallback ? 0 : hallucinatedArticles(answer, chunks),
    verification,
    latencyMs: Date.now() - started,
    fullAnswer: answer,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = (args.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "after") as "before" | "after";
  const only = args.find((a) => a.startsWith("--only="))?.split("=")[1];
  const qs = only ? [QUESTIONS[Number(only) - 1]] : QUESTIONS;

  console.log(`mode=${mode}  cases=${qs.length}\n`);
  const results: CaseReport[] = [];
  for (const [i, q] of qs.entries()) {
    console.log(`[${i + 1}/${qs.length}] ${q}`);
    const r = await runOne(q, mode);
    results.push(r);
    console.log(
      `  n=${r.retrieval.n}${r.retrieval.nA !== undefined ? ` (A:${r.retrieval.nA} B:${r.retrieval.nB})` : ""} conf=${r.retrieval.confidence}(${r.retrieval.confidenceScore})` +
        `  mode=${r.finalMode}  falseRefusalRecovered=${r.falseRefusalRecovered}  directFallback=${r.usedDirectSourceFallback}` +
        `  refs=${r.citationRefs} outOfRange=${r.citationsOutOfRange} proseNums=${r.proseNumbersVerified}ok/${r.proseNumbersRedacted}redacted hallucinatedArts=${r.hallucinatedArticleRefs}` +
        `  verify=${r.verification ? `${r.verification.issues.join(",") || "none"}(${r.verification.severity})` : "n/a"}` +
        `  ${r.latencyMs}ms`
    );
    console.log(`  answer: ${r.answerPreview}\n`);
  }

  const outPath = `./benchmark/e2e-${mode}.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`wrote ${outPath}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
