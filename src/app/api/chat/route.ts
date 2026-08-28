import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, touchSession, hashIp } from "@/lib/session";
import { requireLawyer } from "@/lib/lawyer-auth";
import { rateLimit, LIMITS } from "@/lib/ratelimit";
import { costToday, siteWideCostToday } from "@/lib/costcap";
import { hybridSearch } from "@/lib/search/hybrid";
import { analyzeQuery, analyzeQueryRules, type QueryAnalysis } from "@/lib/search/query-understanding";
import { expandQuery } from "@/lib/search/query-expansion";
import { normalizeQuery } from "@/lib/search/normalize";
import { detectComparison } from "@/lib/search/comparison";
import { comparisonSearch } from "@/lib/search/comparison-search";
import { getChatProvider } from "@/lib/ai";
import {
  buildChatPrompt,
  buildComparisonPrompt,
  buildGapFillPrompt,
  buildGeneralPrompt,
  buildHybridAnalysisPrompt,
  buildStrongGroundingPrompt,
  buildDirectSourceAnswer,
  buildRepairPrompt,
  isRefusal,
  NO_BASIS_ANSWER,
  EXHAUSTED_FALLBACK_ANSWER,
  GENERAL_ANSWER_DISCLAIMER,
  GROUNDED_ANSWER_DISCLAIMER,
  GAP_MARKER_RE,
} from "@/lib/ai/prompts";
import { redactCitations, stripInvalidCitations, verifyCitedNumbers } from "@/lib/ai/guard";
import { verifyAndCleanCitations } from "@/lib/ai/citation-verify";
import { verifyAnswer } from "@/lib/ai/self-verify";
import { env } from "@/lib/env";
import { recordUsage } from "@/lib/analytics";
import { logError } from "@/lib/error-log";
import type { RetrievedChunk } from "@/lib/search/types";
import type { ConfidenceResult } from "@/lib/search/confidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().min(3, "السؤال قصير جداً").max(2000, "السؤال طويل جداً"),
  filters: z
    .object({
      category: z.string().optional(),
      court: z.string().optional(),
      year: z.number().int().optional(),
      sourceType: z.string().optional(),
    })
    .optional(),
});

const ESCAPED_NO_BASIS = NO_BASIS_ANSWER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pulls gap topics out of a grounded answer and returns the text with every
 * trace of them removed, ready to stream/display.
 *
 * The model is told to mark a partial gap with [فجوة: ...] (see GAP_MARKER_RE)
 * rather than write a sentence about it — but that's a prompt instruction, not
 * a guarantee, and it doesn't always comply: observed live, a partially-
 * grounded answer that ended with the reserved full-refusal sentence
 * (NO_BASIS_ANSWER) reused mid-text instead of the marker. That sentence is
 * reserved for a *complete* refusal, so `grounded` was still true — but seeing
 * it embedded is the same signal as a marker: a part of the question has no
 * basis. This is the same "prompt is guidance, not enforcement" lesson
 * guard.ts already encodes for citations, applied to gap detection.
 */
function extractGapsAndClean(answer: string, question: string): { gaps: string[]; cleaned: string } {
  const gaps = [...answer.matchAll(GAP_MARKER_RE)].map((m) => m[1].trim());
  let cleaned = answer.replace(GAP_MARKER_RE, "").replace(/[ \t]{2,}/g, " ");

  if (gaps.length === 0 && cleaned.includes(NO_BASIS_ANSWER)) {
    // Sweep the whole clause the reserved sentence sits in — from the previous
    // sentence boundary up to and including it — since that clause is being
    // replaced wholesale by the gap-fill supplement.
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

/** The query-understanding summary the client and logs care about. */
function toAnalysisPayload(a: QueryAnalysis, expandedWith: string[] = []) {
  return {
    queryType: a.queryType,
    legalArea: a.legalArea,
    expectedLaw: a.expectedLaw,
    legalConcepts: a.legalConcepts,
    needsExpansion: a.needsExpansion,
    method: a.method,
    /** Statutory terms merged into the search text before retrieval. */
    expandedWith,
  };
}

/** What the client needs to render a source card — never the full chunk body. */
function toCitation(c: RetrievedChunk, i: number) {
  return {
    ref: i + 1,
    id: c.id,
    title: c.source_title,
    sourceType: c.source_type,
    articleNumber: c.article_number,
    lawName: c.law_name,
    court: c.court,
    decisionNumber: c.decision_number,
    year: c.year,
    category: c.category,
    excerpt: c.chunk_text.slice(0, 400),
    score: Number(c.score.toFixed(4)),
    matchedBy: c.matched_by,
  };
}

// Thin wrapper around the real handler so that anything thrown before the SSE
// stream starts — a dropped DB connection during requireLawyer/getSession/
// hybridSearch chief among them, since query()/queryOne() in db.ts never
// catch, they propagate raw — turns into the app's own Arabic error response
// instead of Next.js's default error page. Once the stream itself has
// started, failures are a different problem already handled by the try/catch
// around generation further down (an SSE "error" event, since headers are
// already committed by then).
export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (err) {
    logError("[chat] unhandled error before response start:", err);
    return Response.json({ error: "تعذّر معالجة طلبك حالياً. حاول مرة أخرى بعد قليل." }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  const started = Date.now();

  const { response: authError, lawyer } = await requireLawyer();
  if (authError) return authError;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "طلب غير صالح" }, { status: 400 });
  }
  // Normalized once, at the entry point — every downstream consumer (intent
  // parsing, expansion, embedding, the confidence/analysis payload) reads
  // this same normalized text, never the raw request body.
  const { question: rawQuestion, filters = {} } = parsed.data;
  const question = normalizeQuery(rawQuestion);

  const { sessionId } = await getSession();

  // Keyed by the signed-in lawyer's id, not the anonymous session cookie:
  // the cookie resets the moment a client clears it, but the lawyer id is
  // looked up from the database on every request (lawyer-auth.ts's signed
  // cookie only carries the id, never the bucket), so clearing cookies and
  // logging back in under the same name lands on the same bucket again.
  const rl = await rateLimit(`chat:lawyer:${lawyer!.id}`, LIMITS.chat.limit, LIMITS.chat.windowSec);
  if (!rl.ok) {
    return Response.json(
      { error: `تجاوزت الحد المسموح. حاول بعد ${Math.ceil(rl.retryAfterSec / 60)} دقيقة.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Per-IP, not per-lawyer: registering a new lawyer identity is only rate-
  // limited (8/hour/IP — lawyer/register/route.ts), not eliminated, so a
  // script can still mint a handful of fresh chat:lawyer:* buckets per hour
  // per IP. Cost has to stay bounded regardless of identity, so both checks
  // below key on the IP hash, the one thing that survives a cleared cookie
  // AND a freshly registered name.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipKey = hashIp(ip) ?? "unknown";

  const rlDailyIp = await rateLimit(`chat-daily-ip:${ipKey}`, LIMITS.chatDailyIp.limit, LIMITS.chatDailyIp.windowSec);
  if (!rlDailyIp.ok) {
    return Response.json(
      { error: "تجاوزت الحد اليومي المسموح به من هذا الاتصال. حاول غداً." },
      { status: 429, headers: { "Retry-After": String(rlDailyIp.retryAfterSec) } }
    );
  }

  // Circuit breaker: the whole site over budget for today, regardless of who
  // is asking. Checked before the per-IP cap below so a global outage reads
  // as "service paused", not "you personally are rate-limited".
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return Response.json(
      { error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي للموقع. حاول لاحقاً." },
      { status: 503 }
    );
  }
  if ((await costToday(ipKey)) >= env.costCapPerUserUsd) {
    return Response.json(
      { error: "تجاوزت الحد اليومي المسموح للإنفاق من هذا الاتصال. حاول غداً." },
      { status: 429 }
    );
  }

  // Fire-and-forget: a usage-tracking write nothing below reads back (see
  // touchSession's own header comment for why awaiting this used to sit on
  // the critical path — a full DB round-trip before retrieval could even
  // start, for a row only the admin dashboard ever looks at).
  void touchSession(sessionId);

  // The rule tier is synchronous, so the query type is known with no I/O — and
  // that is what gates the expansion's LLM source (fact_pattern only).
  const rules = analyzeQueryRules(question);

  // Comparison detection (search/comparison.ts) — "ما الفرق بين X و Y؟" and
  // variants. Independent of the rule tier's queryType on purpose: it is a
  // strictly additive check (null costs nothing, see its own header comment),
  // so it runs regardless of whether the rules already called this
  // doctrinal_question. When it fires, retrieval and prompt construction take
  // a dedicated path (comparisonSearch / buildComparisonPrompt); everything
  // else below — false-refusal retry, citation guard, self-verify, gap-fill —
  // is untouched, because both paths converge on the same `chunks` array and
  // `system`/`user` prompt shape before any of that runs.
  const comparison = detectComparison(question);

  // analyzeQuery's own LLM fallback (only when the rule tier isn't confident,
  // ~30-40% of natural phrasing per the classifyType patterns) feeds nothing
  // but the "analysis" SSE badge sent far below — neither retrieval branch
  // below reads anything from it (both already have rules.queryType/
  // legalArea synchronously), and today's client (useChat.ts) has no handler
  // for the "analysis" event at all. Measured in scripts/tmp-timing-stages.ts:
  // that fallback call costs ~800-1500ms warm, and blocking retrieval on it
  // would nearly double latency on exactly the questions where it fires, for
  // a value nothing downstream consumes until the "done" event far below.
  // Started here, before either retrieval branch, so its latency is hidden
  // behind retrieval (including a comparison's own zero-result retry) — same
  // overlap this had before comparison detection existed, just no longer
  // tied to one specific retrieval call site now that there are two.
  const analysisPromise = analyzeQuery(question);

  // Populated by whichever branch below runs. `chunksA`/`chunksB` stay empty
  // outside the comparison path — only buildComparisonPrompt reads them.
  let chunks: RetrievedChunk[];
  let embeddingTokens: number;
  let confidence: ConfidenceResult;
  let addedTerms: string[];
  let chunksA: RetrievedChunk[] = [];
  let chunksB: RetrievedChunk[] = [];

  if (comparison) {
    console.log(`[chat] comparison detected: "${comparison.sideA}" vs "${comparison.sideB}"`);
    const cmp = await comparisonSearch(question, comparison.sideA, comparison.sideB, filters, env.topK, {
      queryType: rules.queryType,
      legalArea: rules.legalArea,
    });
    chunks = cmp.chunks;
    chunksA = cmp.chunksA;
    chunksB = cmp.chunksB;
    embeddingTokens = cmp.embeddingTokens;
    confidence = cmp.confidence;
    addedTerms = cmp.addedTerms;

    // Same "never immediately refuse on an empty first pass" principle as
    // the non-comparison path below, applied per side: a side that came back
    // empty gets one forced-LLM-expansion retry rather than being accepted
    // as final immediately.
    if (chunks.length === 0 && env.legalQueryExpansion && env.queryLlmFallback) {
      const retry = await comparisonSearch(question, comparison.sideA, comparison.sideB, filters, env.topK,
        { queryType: rules.queryType, legalArea: rules.legalArea }, { allowLLM: true });
      if (retry.chunks.length > 0) {
        console.log(`[chat] comparison zero-result retry recovered ${retry.chunks.length} chunk(s) via forced LLM expansion`);
        chunks = retry.chunks;
        chunksA = retry.chunksA;
        chunksB = retry.chunksB;
        embeddingTokens += retry.embeddingTokens;
        confidence = retry.confidence;
        addedTerms = retry.addedTerms;
      }
    }
  } else {
    // Expansion must complete before retrieval: it decides what gets embedded.
    // For every type but fact_pattern this is the free ontology lookup, so only
    // the fact-pattern case — the one where lay wording and statutory wording
    // actually diverge — pays for a model call here.
    const expansion = await expandQuery(question, rules);
    addedTerms = expansion.addedTerms;
    if (expansion.addedTerms.length > 0) {
      console.log(`[chat] expanded (${expansion.source}):`, expansion.addedTerms.join(" | "));
    }

    const search = await hybridSearch(question, filters, undefined, {
      searchText: expansion.searchText,
      orGroup: expansion.orGroup,
      // Selects the relevance floor AND the confidence weighting. Taken from
      // the rule tier so it is known without waiting on the LLM classifier.
      queryType: rules.queryType,
      // Soft topic-match bonus (see hybrid.ts's AREA_TOPICS) — same rule tier,
      // same reasoning: known synchronously, no reason to wait on the LLM.
      legalArea: rules.legalArea,
    });
    chunks = search.chunks;
    embeddingTokens = search.embeddingTokens;
    confidence = search.confidence;

    // Nothing cleared the relevance gate on the first pass. Before treating that
    // as final, retry once with forced LLM expansion — but only when the first
    // pass didn't already try it: fact_pattern questions always do (see
    // expandQuery), so retrying those again would just repeat the same call.
    if (chunks.length === 0 && rules.queryType !== "fact_pattern" && env.legalQueryExpansion && env.queryLlmFallback) {
      const retryExpansion = await expandQuery(question, rules, { allowLLM: true });
      if (retryExpansion.addedTerms.length > 0) {
        const retry = await hybridSearch(question, filters, undefined, {
          searchText: retryExpansion.searchText,
          orGroup: retryExpansion.orGroup,
          queryType: rules.queryType,
          legalArea: rules.legalArea,
        });
        if (retry.chunks.length > 0) {
          console.log(`[chat] zero-result retry recovered ${retry.chunks.length} chunk(s) via forced LLM expansion`);
          chunks = retry.chunks;
          embeddingTokens += retry.embeddingTokens;
          confidence = retry.confidence;
        }
      }
    }
  }

  const encoder = new TextEncoder();
  const send = (ctrl: ReadableStreamDefaultController, event: string, data: unknown) =>
    ctrl.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  // Nothing cleared the relevance gate: the knowledge base has no source for
  // this question. Both branches below need the resolved payload synchronously
  // (neither builds an async stream start), and this is the rare, already-slow
  // path (a second full LLM call either way) — no reason to keep it deferred.
  if (chunks.length === 0) {
    const analysisPayload = toAnalysisPayload(await analysisPromise, addedTerms);

    // The "never immediately refuse" sequence — query expansion, a second
    // retrieval, then general-knowledge GPT analysis — is exactly what
    // already ran to get here: the zero-result retry above IS steps 1+2, and
    // generalAnswerStream below is step 3. This branch is reached only when
    // step 3 is itself disabled (allowGeneralFallback=false, not the
    // default — see env.ts), so it is genuinely the system having exhausted
    // every fallback, not a first resort. EXHAUSTED_FALLBACK_ANSWER, not
    // NO_BASIS_ANSWER: that one means the model declined real sources
    // mid-generation, which is not what happened here — there were no
    // sources to decline.
    if (!env.allowGeneralFallback) {
      const stream = new ReadableStream({
        start(ctrl) {
          send(ctrl, "analysis", analysisPayload);
          send(ctrl, "sources", []);
          send(ctrl, "delta", { text: EXHAUSTED_FALLBACK_ANSWER });
          send(ctrl, "done", { grounded: false, mode: "refused", sources: [] });
          ctrl.close();
        },
      });

      void recordUsage({
        sessionId,
        costKey: ipKey,
        question,
        answer: EXHAUSTED_FALLBACK_ANSWER,
        sourcesUsed: [],
        grounded: false,
        mode: "refused",
        tokensIn: 0,
        tokensOut: 0,
        embeddingTokens,
        latencyMs: Date.now() - started,
        category: filters.category ?? null,
        hitCount: 0,
      });

      return sseResponse(stream);
    }

    return sseResponse(
      generalAnswerStream({ question, sessionId, costKey: ipKey, embeddingTokens, started, filters, send, analysisPayload })
    );
  }

  const citations = chunks.map(toCitation);
  // Comparison questions get the side-structured prompt (see its own header
  // comment for why a flat source list specifically fails this question
  // shape); every other question keeps the exact prompt it always used.
  const { system, user } = comparison
    ? buildComparisonPrompt(question, comparison.sideA, comparison.sideB, chunks, chunksA, chunksB)
    : buildChatPrompt(question, chunks);
  const provider = getChatProvider();

  // Type-2 "hybrid": sources exist but overall confidence came back low.
  // Started now, in parallel with the main grounded stream below — confidence
  // is already known before either call runs, so this costs no extra
  // wall-clock latency (same overlap pattern already used for analysisPromise
  // above). Never allowed to fail the request: a rejected call just means no
  // supplement.
  const hybridPromise =
    env.hybridFallback && confidence.label === "منخفضة"
      ? (() => {
          const { system: hSystem, user: hUser } = buildHybridAnalysisPrompt(question, chunks);
          return provider
            .chat(
              [
                { role: "system", content: hSystem },
                { role: "user", content: hUser },
              ],
              { maxTokens: 700 }
            )
            .catch((err) => {
              logError("[chat] hybrid analysis failed:", err);
              return null;
            });
        })()
      : null;

  const stream = new ReadableStream({
    async start(ctrl) {
      // Sources first: the UI renders the citation panel while the answer is
      // still streaming, so the lawyer can start reading the authorities
      // instead of watching a spinner. (The "analysis" badge event used to be
      // sent before this — it now waits until analysisPromise resolves, near
      // "done" below, so a slow classifier call can never hold up sources or
      // the start of generation.)
      send(ctrl, "sources", citations);

      let answer = "";
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        const gen = provider.chatStream([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);

        let next = await gen.next();
        while (!next.done) {
          answer += next.value;
          send(ctrl, "delta", { text: next.value });
          next = await gen.next();
        }
        tokensIn = next.value.tokensIn;
        tokensOut = next.value.tokensOut;

        // The model refused for lack of basis — see prompts.ts's isRefusal for
        // why the check strips quote marks first. This is the exact same
        // "instruction, not guarantee" gap that GAP_MARKER_RE's fallback below
        // exists to catch, applied to full refusals instead of partial gaps.
        let grounded = !isRefusal(answer);
        // The text actually shown to the lawyer from here on — starts as the
        // raw streamed `answer`, and is replaced below if a false-refusal
        // retry fires. `answer` itself stays untouched: the final "done" event
        // compares against it to decide whether the client needs to overwrite
        // what it already streamed via `delta`.
        let effectiveAnswer = answer;
        // Observability: did this request need the false-refusal recovery at
        // all, and did it need the deterministic fallback specifically (the
        // forced retry ALSO refused/errored)? Surfaced in the "done" event and
        // recordUsage so this is visible in the dashboard, not just server logs.
        let falseRefusalRecovered = false;
        let usedDirectSourceFallback = false;

        // FALSE REFUSAL. By construction this stream only starts once
        // chunks.length > 0 (the zero-chunk case returns earlier, before this
        // stream is built) — so a refusal reaching this line is never "no
        // source exists". It is the model declining sources that
        // search/confidence.ts's relevance gate already measured as good
        // enough. That is a generation failure, not a retrieval failure, and
        // "never refuse when verified sources exist" means it does not reach
        // the lawyer as one: one automatic retry with a forced-grounding
        // prompt (stronger instructions + the sources re-shown with their
        // citation identity highlighted), and if even that refuses or the
        // call itself fails, a deterministic answer built straight from the
        // retrieved text with no model call at all — which cannot refuse,
        // because nothing is being asked of it.
        if (!grounded) {
          console.warn(
            `[chat] false refusal detected — ${chunks.length} source(s) had already passed the relevance gate; retrying with forced grounding`
          );
          falseRefusalRecovered = true;
          try {
            const { system: fgSystem, user: fgUser } = buildStrongGroundingPrompt(question, chunks);
            const retry = await provider.chat(
              [
                { role: "system", content: fgSystem },
                { role: "user", content: fgUser },
              ],
              { maxTokens: 1200 }
            );
            tokensIn += retry.tokensIn;
            tokensOut += retry.tokensOut;

            if (!isRefusal(retry.text)) {
              effectiveAnswer = retry.text;
              grounded = true;
            } else {
              console.warn("[chat] forced-grounding retry refused again — falling back to a direct source excerpt");
              effectiveAnswer = buildDirectSourceAnswer(chunks);
              grounded = true;
              usedDirectSourceFallback = true;
            }
          } catch (err) {
            logError("[chat] forced-grounding retry failed:", err);
            effectiveAnswer = buildDirectSourceAnswer(chunks);
            grounded = true;
            usedDirectSourceFallback = true;
          }
        }
        if (!grounded) send(ctrl, "sources", []);

        // The grounded answer may have marked partial gaps with [فجوة: ...]
        // instead of guessing or apologizing (see GAP_MARKER_RE) — or reused
        // the reserved refusal sentence inline, which extractGapsAndClean also
        // catches. Fill those — and only those — with a separate, tightly-
        // scoped general-knowledge call, guarded by the same redactCitations()
        // the fully-ungrounded path uses. Never spliced into the cited text:
        // sent as its own event so the client can fence it visually.
        let gapFillText: string | null = null;
        let gapFillRedactedCount = 0;
        let cleanedAnswer = effectiveAnswer;
        // Article/decision numbers the model wrote in its own prose, checked
        // against the metadata of the exact chunk their nearest [n] marker
        // cites — see verifyCitedNumbers' header comment in guard.ts for why
        // this is a purpose-built check rather than a reuse of
        // citation-verify.ts's DB-backed one (built for, and only correct
        // for, the freer-form Type-2 supplement). Skipped for
        // usedDirectSourceFallback: that text is verbatim chunk content with
        // no model generation involved, so every number in it is already
        // guaranteed correct by construction — nothing to check.
        let answerVerifiedCount = 0;
        let answerRedactedCount = 0;
        // Hoisted out of the block below so the self-verification step
        // further down can tell the judge which topics were already
        // honestly gap-marked — see self-verify.ts's knownGaps.
        let gaps: string[] = [];
        if (grounded) {
          const extracted = extractGapsAndClean(effectiveAnswer, question);
          gaps = extracted.gaps;
          const { cleaned } = extracted;
          const { text: citationsChecked, strippedCount } = stripInvalidCitations(cleaned, chunks.length);
          if (strippedCount > 0) {
            console.warn(`[chat] stripped ${strippedCount} out-of-range citation ref(s) — only ${chunks.length} source(s) were retrieved`);
          }

          if (usedDirectSourceFallback) {
            cleanedAnswer = citationsChecked;
          } else {
            const verified = verifyCitedNumbers(citationsChecked, chunks);
            cleanedAnswer = verified.text;
            answerVerifiedCount = verified.verifiedCount;
            answerRedactedCount = verified.redactedCount;
            if (verified.redactedCount > 0) {
              console.warn(`[chat] redacted ${verified.redactedCount} unverified article/decision number(s) from the grounded answer`);
            }
          }

          if (gaps.length > 0) {
            try {
              const { system: gapSystem, user: gapUser } = buildGapFillPrompt(question, gaps);
              const gapResult = await provider.chat(
                [
                  { role: "system", content: gapSystem },
                  { role: "user", content: gapUser },
                ],
                { maxTokens: 600 }
              );
              const redaction = redactCitations(gapResult.text);
              gapFillText = redaction.text;
              gapFillRedactedCount = redaction.redactedCount;
              tokensIn += gapResult.tokensIn;
              tokensOut += gapResult.tokensOut;
              send(ctrl, "gapfill", { text: gapFillText, redactedCount: gapFillRedactedCount });
            } catch (err) {
              // A failed gap-fill must not take down an otherwise-good grounded
              // answer — the gap markers just stay unfilled and get stripped
              // from display client-side.
              logError("[chat] gap-fill failed:", err);
            }
          }
        }

        // PHASE 6 — post-generation self-verification. Runs on the final
        // grounded answer only (not usedDirectSourceFallback — verbatim
        // chunk text with zero model generation cannot fail any of these
        // checks by construction, so verifying it would be pure cost with no
        // possible benefit). One quality-control pass with at most one
        // repair regeneration, per self-verify.ts's own design notes for why
        // severity/action are computed in code rather than trusted from the
        // model's own self-report.
        let verification: Awaited<ReturnType<typeof verifyAnswer>> | null = null;
        // Distinct from verification.action: action describes the FINAL
        // state, which reads "return" both when nothing was ever wrong and
        // when a repair fixed it — this flag is the only way to tell those
        // two apart for observability.
        let verificationRepaired = false;
        if (grounded && !usedDirectSourceFallback && env.selfVerification) {
          verification = await verifyAnswer({
            question,
            chunks,
            answer: cleanedAnswer,
            citationCheck: { verifiedCount: answerVerifiedCount, redactedCount: answerRedactedCount },
            isRepairAttempt: false,
            knownGaps: gaps,
          });

          if (verification.action === "regenerate") {
            console.warn(
              `[chat] self-verification flagged [${verification.issues.join(", ")}] (${verification.severity}) — attempting one repair regeneration`
            );
            try {
              const { system: repairSystem, user: repairUser } = buildRepairPrompt(question, chunks, cleanedAnswer, verification.issues);
              const repair = await provider.chat(
                [
                  { role: "system", content: repairSystem },
                  { role: "user", content: repairUser },
                ],
                { maxTokens: 1200 }
              );
              tokensIn += repair.tokensIn;
              tokensOut += repair.tokensOut;

              // The repair is itself a fresh generation and could introduce
              // its own bad numbers — the mechanical citation check runs
              // again on it, exactly as it did on the first attempt.
              const { text: repairCitationsChecked } = stripInvalidCitations(repair.text, chunks.length);
              const repairChecked = verifyCitedNumbers(repairCitationsChecked, chunks);

              const repairVerification = await verifyAnswer({
                question,
                chunks,
                answer: repairChecked.text,
                citationCheck: { verifiedCount: repairChecked.verifiedCount, redactedCount: repairChecked.redactedCount },
                isRepairAttempt: true,
                knownGaps: gaps,
              });

              if (repairVerification.action === "return") {
                cleanedAnswer = repairChecked.text;
                answerVerifiedCount = repairChecked.verifiedCount;
                answerRedactedCount = repairChecked.redactedCount;
              } else {
                // The one allowed repair attempt is exhausted (regeneration
                // limit: 2 total verification passes, matching the spec) and
                // issues remain — fall back to the safest possible answer
                // rather than loop. Verbatim source text cannot hallucinate,
                // contradict itself, or misstate a citation, so this is a
                // strictly safer floor than either the original or the
                // repaired attempt, at the cost of losing the model's prose.
                console.warn(
                  `[chat] repair still flagged [${repairVerification.issues.join(", ")}] — falling back to a direct source answer`
                );
                cleanedAnswer = buildDirectSourceAnswer(chunks);
                answerVerifiedCount = 0;
                answerRedactedCount = 0;
              }
              verification = repairVerification;
              verificationRepaired = true;
            } catch (err) {
              // A failed repair call must not take down an already-generated
              // answer — ship the pre-repair text; the (failing) verification
              // result from BEFORE the repair attempt is still logged below,
              // so the failure stays visible even though nothing further
              // was attempted.
              logError("[chat] repair generation failed:", err);
            }
          }
        }

        // Type-2 hybrid supplement: the call was kicked off in parallel above
        // and may already be settled. Its tokens count toward cost whether or
        // not the answer ended up grounded (the call was made either way), but
        // it is only verified and shown when the primary answer is — a model
        // that itself refused has nothing for a supplement to sit beside.
        let hybridText: string | null = null;
        let hybridVerifiedCount = 0;
        let hybridRedactedCount = 0;
        if (hybridPromise) {
          const hybridResult = await hybridPromise;
          if (hybridResult) {
            tokensIn += hybridResult.tokensIn;
            tokensOut += hybridResult.tokensOut;
            if (grounded) {
              const verified = await verifyAndCleanCitations(hybridResult.text);
              hybridText = verified.text;
              hybridVerifiedCount = verified.verifiedCount;
              hybridRedactedCount = verified.redactedCount;
              send(ctrl, "hybrid", {
                text: hybridText,
                verifiedCount: hybridVerifiedCount,
                redactedCount: hybridRedactedCount,
              });
            }
          }
        }

        // analyzeQuery was kicked off before hybridSearch, far above. By now —
        // after the full generation loop and the false-refusal/gap-fill
        // recovery paths, all of which take several seconds — its LLM
        // fallback (worst case ~4s, LLM_TIMEOUT_MS) has essentially always
        // already resolved, so this await costs ~0ms in practice. Awaited
        // here rather than left as a bare `.then()` so a still-pending
        // classifier can never enqueue onto a controller ctrl.close() has
        // already closed.
        send(ctrl, "analysis", toAnalysisPayload(await analysisPromise, addedTerms));

        // "grounded_retry" is its own mode value (grounded=true either way —
        // see admin/stats/route.ts's queries, which only ever filter mode
        // WITHIN grounded=false, so this new value cannot affect them) so the
        // admin dashboard can see how often the false-refusal recovery fires,
        // instead of that being indistinguishable from an answer that was
        // grounded on the first attempt.
        const mode = !grounded ? "refused" : falseRefusalRecovered ? "grounded_retry" : "grounded";

        send(ctrl, "done", {
          grounded,
          mode,
          sources: grounded ? citations : [],
          // Same field the ungrounded path sends as GENERAL_ANSWER_DISCLAIMER —
          // this is the cited path's counterpart, so the answer type a lawyer
          // is most inclined to trust outright never ships with no notice at
          // all. Withheld on refusal: there is no answer to caveat.
          disclaimer: grounded ? GROUNDED_ANSWER_DISCLAIMER : undefined,
          // Backend-computed, never model-reported. Withheld when the model
          // refused: confidence describes the evidence behind an answer, and a
          // refusal has no answer to be confident about.
          confidence: grounded ? confidence : null,
          // Only set when it differs from what already streamed — i.e. a gap
          // clause got swept out, or a false refusal got corrected. The client
          // overwrites its accumulated text with this so the leftover
          // "لم أجد سنداً..." doesn't linger on screen once the real answer
          // (gap-fill supplement, or the forced-retry/fallback answer) replaces it.
          content: cleanedAnswer !== answer ? cleanedAnswer : undefined,
          gapFill: gapFillText,
          gapFillRedactedCount,
          // Article/decision numbers checked against the cited chunk's own
          // metadata (see verifyCitedNumbers in guard.ts) — 0/0 whenever
          // usedDirectSourceFallback skipped the check because there was
          // nothing to verify (verbatim DB text already).
          answerVerifiedCount,
          answerRedactedCount,
          hybridAnalysis: hybridText,
          hybridAnalysisVerifiedCount: hybridVerifiedCount,
          hybridAnalysisRedactedCount: hybridRedactedCount,
          // False-refusal recovery detail, for a UI that wants to say
          // "تم التحقق تلقائياً" — never required, always safe to ignore.
          falseRefusalRecovered,
          usedDirectSourceFallback,
          // Phase 6 self-verification — null when it didn't run at all
          // (usedDirectSourceFallback, or the answer wasn't grounded), never
          // shown directly to the lawyer, but available for a future admin
          // badge the same way falseRefusalRecovered is today.
          verification: verification
            ? { passed: verification.passed, issues: verification.issues, severity: verification.severity, repaired: verificationRepaired }
            : null,
        });

        void recordUsage({
          sessionId,
          costKey: ipKey,
          question,
          // cleanedAnswer, not the raw streamed `answer`: when a false-refusal
          // retry fired, `answer` is the discarded refusal text, and logging
          // that instead of what the lawyer actually saw would make the
          // history/analytics reflect a conversation that never happened.
          answer: [
            cleanedAnswer,
            gapFillText ? `\n\n[تكملة عامة]\n${gapFillText}` : "",
            hybridText ? `\n\n[تحليل تكميلي]\n${hybridText}` : "",
          ].join(""),
          sourcesUsed: grounded ? citations : [],
          grounded,
          mode,
          tokensIn,
          tokensOut,
          embeddingTokens,
          latencyMs: Date.now() - started,
          category: filters.category ?? null,
          hitCount: chunks.length,
          verification: verification
            ? { issues: verification.issues, severity: verification.severity, action: verification.action, repaired: verificationRepaired }
            : null,
        });
      } catch (err) {
        logError("[chat] stream failed:", err);
        send(ctrl, "error", { message: "تعذّر توليد الإجابة. حاول مرة أخرى." });
      } finally {
        ctrl.close();
      }
    },
  });

  return sseResponse(stream);
}

type GeneralArgs = {
  question: string;
  sessionId: string;
  costKey: string;
  embeddingTokens: number;
  started: number;
  filters: { category?: string };
  send: (ctrl: ReadableStreamDefaultController, event: string, data: unknown) => void;
  analysisPayload: ReturnType<typeof toAnalysisPayload>;
};

/**
 * The ungrounded path: no source in the knowledge base, so answer from the
 * model's general knowledge — orientation only, never a citation.
 *
 * NOT STREAMED, deliberately.
 *
 * The grounded path streams because every word is backed by a retrieved chunk.
 * Here the answer must pass `redactCitations()` before a lawyer sees it, and
 * you cannot redact a token you have already sent. Streaming would put
 * "المادة 780 من القانون المدني" on screen and then take it back — the reader
 * has already read it, and a fabricated article number that was briefly
 * visible is exactly the harm the guard exists to prevent.
 *
 * So: generate fully, redact, then send. A few seconds of spinner is the price
 * of the guarantee.
 */
function generalAnswerStream(a: GeneralArgs): ReadableStream {
  const provider = getChatProvider();
  const { system, user } = buildGeneralPrompt(a.question);

  return new ReadableStream({
    async start(ctrl) {
      a.send(ctrl, "analysis", a.analysisPayload);
      // No sources — there are none, and an empty panel says so honestly.
      a.send(ctrl, "sources", []);

      try {
        const result = await provider.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { maxTokens: 1200 }
        );

        const { text, redactedCount, redacted } = redactCitations(result.text);
        if (redactedCount > 0) {
          // The prompt told it not to cite. It cited anyway. This is the whole
          // reason the guard is code and not a prompt instruction — log it so
          // the rate is visible rather than assumed.
          console.warn(
            `[chat] redacted ${redactedCount} fabricated citation(s) from an ungrounded answer:`,
            redacted.slice(0, 5)
          );
        }

        a.send(ctrl, "delta", { text });
        a.send(ctrl, "done", {
          grounded: false,
          mode: "general",
          sources: [],
          disclaimer: GENERAL_ANSWER_DISCLAIMER,
          redactedCount,
        });

        void recordUsage({
          sessionId: a.sessionId,
          costKey: a.costKey,
          question: a.question,
          // Store the redacted text, not the raw output: chat_history is read
          // by the admin dashboard, and an unredacted fabricated citation
          // sitting in the log is the same hazard one screen removed.
          answer: text,
          sourcesUsed: [],
          // Ungrounded by definition. The dashboard's "نسبة الإجابات المُسنَدة"
          // must keep counting these as unsupported.
          grounded: false,
          // Same literal the "done" SSE event sends the client above — without
          // this, admin/stats's general_answers count (WHERE mode = 'general')
          // silently undercounts, since e.mode defaults to NULL, not "general".
          mode: "general",
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          embeddingTokens: a.embeddingTokens,
          latencyMs: Date.now() - a.started,
          category: a.filters.category ?? null,
          hitCount: 0,
        });
      } catch (err) {
        logError("[chat] general answer failed:", err);
        a.send(ctrl, "error", { message: "تعذّر توليد الإجابة. حاول مرة أخرى." });
      } finally {
        ctrl.close();
      }
    },
  });
}

function sseResponse(stream: ReadableStream) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffers proxied responses by default, which holds the whole SSE
      // stream until the request ends and defeats streaming entirely.
      "X-Accel-Buffering": "no",
    },
  });
}
