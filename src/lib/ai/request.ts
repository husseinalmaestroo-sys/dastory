import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { query } from "../db";
import { rateLimit, LIMITS } from "../ratelimit";
import { addCost, costToday, siteWideCostToday } from "../costcap";
import { logError } from "../error-log";
import type { Caller } from "../caller";
import { UsageMeter, withRequestScope, type UsageTotals } from "./usage-meter";
import { AiTimeoutError, linkSignal } from "./deadline";
import { corpusVersion, promptVersion } from "./versioning";
import { runRetentionIfDue } from "../retention";

/**
 * The lifecycle every AI request goes through (Phase 2: cost control, usage
 * accounting, observability, versioning, timeouts):
 *
 *   admit()        rate limits (per person), daily volume ceilings, the
 *                  site-wide and per-caller USD circuit breakers — keyed per
 *                  office/user for Dostoori (caller.ts), never on a
 *                  client-supplied header;
 *   runAiRequest() runs the pipeline inside a request scope: every model
 *                  call is metered (usage-meter.ts) and inherits one abort
 *                  signal fired by the feature's overall deadline or by the
 *                  client disconnecting; then records ONE ai_requests row and
 *                  ONE structured log line — metadata only, never the
 *                  question, document or answer — and charges the real,
 *                  per-model cost to the caller's cost bucket.
 *
 * A failed or timed-out request is still accounted (its calls were made),
 * and is reported to the caller as failed, so Dostoori's quota — which
 * counts successes only — does not charge the office for it.
 */

export type AiFeature = "chat" | "case_analysis" | "contract_review" | "draft" | "draft_refine" | "draft_export";

type Window = { limit: number; windowSec: number };
const FEATURE_LIMITS: Record<AiFeature, { burst: Window; daily?: Window }> = {
  chat: { burst: LIMITS.chat, daily: LIMITS.chatDailyIp },
  case_analysis: { burst: LIMITS.upload, daily: LIMITS.uploadDailyIp },
  contract_review: { burst: LIMITS.upload, daily: LIMITS.uploadDailyIp },
  draft: { burst: LIMITS.draft, daily: LIMITS.draftDailyIp },
  draft_refine: { burst: LIMITS.refine, daily: LIMITS.refineDailyIp },
  draft_export: { burst: LIMITS.draft },
};

/**
 * Overall deadline per feature — shorter than the Dostoori client's own
 * timeout for the same call (legal-rag-client.ts), so the engine answers with
 * a controlled 504 before the caller gives up on it.
 */
const DEADLINES_MS: Record<AiFeature, number> = {
  chat: 55_000,
  case_analysis: 110_000,
  contract_review: 110_000,
  draft: 85_000,
  draft_refine: 45_000,
  draft_export: 30_000,
};

export function deadlineFor(feature: AiFeature): number {
  const override = Number(process.env.AI_REQUEST_DEADLINE_MS);
  return Number.isFinite(override) && override > 0 ? override : DEADLINES_MS[feature];
}

const json = (body: unknown, status: number, headers?: Record<string, string>) => Response.json(body, { status, headers });

/** Limits and circuit breakers; a Response when the request must be refused, else null. */
export async function admit(caller: Caller, feature: AiFeature): Promise<Response | null> {
  const lim = FEATURE_LIMITS[feature];
  const burst = await rateLimit(`${feature}:${caller.rateKey}`, lim.burst.limit, lim.burst.windowSec);
  if (!burst.ok) {
    return json(
      { error: `تجاوزت الحد المسموح. حاول بعد ${Math.max(1, Math.ceil(burst.retryAfterSec / 60))} دقيقة.` },
      429,
      { "Retry-After": String(burst.retryAfterSec) }
    );
  }
  if (lim.daily) {
    // Standalone users: per connection (IP hash), since a lawyer identity is
    // free to mint. Service callers: per office user (the IP is Dostoori's
    // server, shared by every office).
    const dailyKey = caller.kind === "lawyer" ? `ip:${caller.ipKey}` : caller.rateKey;
    const daily = await rateLimit(`${feature}-daily:${dailyKey}`, lim.daily.limit, lim.daily.windowSec);
    if (!daily.ok) {
      return json({ error: "تجاوزت الحد اليومي المسموح به. حاول غداً." }, 429, { "Retry-After": String(daily.retryAfterSec) });
    }
  }
  if ((await siteWideCostToday()) >= env.costCapSiteUsd) {
    return json({ error: "الخدمة متوقفة مؤقتاً بسبب بلوغ حد الإنفاق اليومي. حاول لاحقاً." }, 503);
  }
  if ((await costToday(caller.costKey)) >= caller.costCapUsd) {
    return json({ error: "تم بلوغ حد الإنفاق اليومي المسموح لهذا الحساب. حاول غداً." }, 429);
  }
  return null;
}

export type RequestOutcome = {
  success: boolean;
  /** e.g. grounded | partial | no_evidence | sources_only | out_of_jurisdiction | invalid_output | … */
  outcome: string;
  groundingLevel?: string | null;
  retrievalCount?: number;
  sourceCount?: number;
};

export type UsageReport = {
  requestId: string;
  llmCalls: number;
  failedCalls: number;
  embeddingCalls: number;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  /** Estimate at pricing.ts rates (USD), never a bill. */
  estimatedCostUsd: number;
  byPurpose: Record<string, number>;
  unpricedModels: string[];
};

export type Provenance = {
  promptVersion: string;
  corpusVersion: string;
  chatModels: string[];
  embeddingModel: string | null;
};

export type RunResult<T> =
  | { ok: true; value: T; usage: UsageReport; provenance: Provenance }
  | { ok: false; error: "timeout" | "failed"; usage: UsageReport; provenance: Provenance };

function usageReport(requestId: string, t: UsageTotals): UsageReport {
  return {
    requestId,
    llmCalls: t.llmCalls,
    failedCalls: t.failedCalls,
    embeddingCalls: t.embeddingCalls,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    embeddingTokens: t.embeddingTokens,
    estimatedCostUsd: Number(t.costUsd.toFixed(6)),
    byPurpose: t.byPurpose,
    unpricedModels: t.unpricedModels,
  };
}

/**
 * Where a request's time went (Phase 2.1): the pipeline's own stages
 * (retrieval, grounding) and model time per purpose ("model.answer",
 * "model.judge", "model.embed"…). Numbers only.
 */
export function stageTimings(t: UsageTotals): Record<string, number> {
  const out: Record<string, number> = { ...t.stages };
  for (const [purpose, ms] of Object.entries(t.msByPurpose)) out[`model.${purpose}`] = ms;
  return out;
}

async function record(caller: Caller, feature: AiFeature, requestId: string, meter: UsageMeter, outcome: RequestOutcome, latencyMs: number, provenance: Provenance) {
  const t = meter.totals();
  // The real spend, at each call's own model price, against the caller's
  // bucket (site-wide spend is the sum of all buckets).
  await addCost(caller.costKey, t.costUsd);
  try {
    await query(
      `INSERT INTO ai_requests
         (request_id, caller_kind, office_id, user_id, lawyer_id, feature, chat_model, embedding_model,
          prompt_version, corpus_version, llm_calls, tokens_in, tokens_out, embedding_tokens, cost_usd,
          latency_ms, success, outcome, grounding_level, retrieval_count, source_count, stage_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        requestId,
        caller.kind,
        caller.kind === "service" ? caller.principal.officeId : null,
        caller.kind === "service" ? caller.principal.userId : null,
        caller.kind === "lawyer" ? caller.lawyer.id : null,
        feature,
        t.chatModels.join(",") || null,
        t.embeddingModel,
        provenance.promptVersion,
        provenance.corpusVersion,
        t.llmCalls,
        t.tokensIn,
        t.tokensOut,
        t.embeddingTokens,
        t.costUsd,
        latencyMs,
        outcome.success,
        outcome.outcome.slice(0, 40),
        outcome.groundingLevel ?? null,
        outcome.retrievalCount ?? null,
        outcome.sourceCount ?? null,
        JSON.stringify(stageTimings(t)),
      ]
    );
  } catch (err) {
    logError("[ai-request] failed to record accounting row:", err);
  }
  // One structured line per request. Identifiers and numbers only — never
  // the question, the document, the answer, keys or tokens.
  console.log(
    JSON.stringify({
      evt: "ai_request",
      requestId,
      caller: caller.kind,
      office: caller.kind === "service" ? caller.principal.officeId : null,
      user: caller.kind === "service" ? caller.principal.userId : null,
      lawyer: caller.kind === "lawyer" ? caller.lawyer.id : null,
      feature,
      models: t.chatModels,
      embeddingModel: t.embeddingModel,
      promptVersion: provenance.promptVersion,
      corpusVersion: provenance.corpusVersion,
      latencyMs,
      success: outcome.success,
      outcome: outcome.outcome,
      grounding: outcome.groundingLevel ?? null,
      retrieved: outcome.retrievalCount ?? null,
      sources: outcome.sourceCount ?? null,
      stageMs: stageTimings(t),
      llmCalls: t.llmCalls,
      failedCalls: t.failedCalls,
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      embeddingTokens: t.embeddingTokens,
      costUsd: Number(t.costUsd.toFixed(6)),
    })
  );
}

/**
 * Runs `fn` as one accounted AI request. Never throws: a pipeline exception
 * or the deadline becomes `{ ok: false }` (details logged, never returned).
 */
export async function runAiRequest<T extends { outcome: RequestOutcome }>(
  caller: Caller,
  feature: AiFeature,
  clientSignal: AbortSignal | undefined,
  fn: (ctx: { requestId: string; signal: AbortSignal }) => Promise<T>
): Promise<RunResult<T>> {
  const requestId = caller.kind === "service" ? caller.principal.requestId : randomUUID();
  // Phase 2.1: retention runs itself — at most every few hours across the
  // deployment, never in the request's path (fire-and-forget).
  void runRetentionIfDue();
  const meter = new UsageMeter();
  const ctrl = new AbortController();
  linkSignal(ctrl, clientSignal);
  const started = Date.now();
  const ms = deadlineFor(feature);
  const [pv, cv] = [promptVersion(), await corpusVersion()];
  const provenance = (): Provenance => {
    const t = meter.totals();
    return { promptVersion: pv, corpusVersion: cv, chatModels: t.chatModels, embeddingModel: t.embeddingModel };
  };

  const work = withRequestScope({ meter, signal: ctrl.signal }, () => fn({ requestId, signal: ctrl.signal }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new AiTimeoutError(`${feature} request`, ms));
    }, ms);
  });

  try {
    const value = await Promise.race([work, timeout]);
    await record(caller, feature, requestId, meter, value.outcome, Date.now() - started, provenance());
    return { ok: true, value, usage: usageReport(requestId, meter.totals()), provenance: provenance() };
  } catch (err) {
    const timedOut = err instanceof AiTimeoutError && ctrl.signal.aborted && !clientSignal?.aborted;
    const outcome: RequestOutcome = { success: false, outcome: timedOut ? "timeout" : clientSignal?.aborted ? "client_aborted" : "error" };
    if (!timedOut) logError(`[ai-request] ${feature} failed:`, err);
    // The pipeline was aborted; account for it once whatever is in flight has settled.
    const settle = work.then(
      () => undefined,
      () => undefined
    );
    if (timedOut) {
      void settle.then(() => record(caller, feature, requestId, meter, outcome, Date.now() - started, provenance()));
    } else {
      await record(caller, feature, requestId, meter, outcome, Date.now() - started, provenance());
    }
    return { ok: false, error: timedOut ? "timeout" : "failed", usage: usageReport(requestId, meter.totals()), provenance: provenance() };
  } finally {
    clearTimeout(timer);
  }
}

/** The response for a failed runAiRequest — generic by design (no internals). */
export function failureResponse(result: { error: "timeout" | "failed"; usage: UsageReport }): Response {
  return result.error === "timeout"
    ? json({ error: "انتهت مهلة معالجة الطلب. حاول مرة أخرى.", requestId: result.usage.requestId }, 504)
    : json({ error: "تعذّر إكمال الطلب حالياً. حاول مرة أخرى بعد قليل.", requestId: result.usage.requestId }, 502);
}
