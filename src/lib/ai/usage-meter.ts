import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { estimateCost, isPriced } from "./pricing";

/**
 * Per-request accounting of EVERY model call (Phase 2, cost control).
 *
 * WHY A CONTEXT AND NOT RETURN VALUES
 *
 * Token counts used to be threaded back by hand from the calls each route
 * knew about. Several calls never made it into usage at all: the query-
 * understanding classifier, the LLM query expansion, the self-verification
 * judge (twice on a repair), and — for streamed answers — nothing if the
 * stream failed half-way. And recordUsage priced every token at the default
 * chat model, so a judge running on a cheaper model, or an embedding, was
 * mispriced.
 *
 * The provider registry (ai/index.ts) now wraps every chat / stream /
 * embedding / rerank call and records it into the meter of the request it
 * runs in (AsyncLocalStorage), with the model that actually served it. A
 * call cannot be forgotten, and each is priced at its own model's rate.
 *
 * Failed calls are recorded too (ok: false, tokens 0 — a failed call's
 * provider-side usage is not reported to us, so it is UNKNOWN, not zero;
 * `failedCalls` makes that visible instead of pretending it was free).
 */

export type CallKind = "chat" | "stream" | "embed" | "rerank";

export type MeterEntry = {
  kind: CallKind;
  purpose: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  ms: number;
  ok: boolean;
};

export type UsageTotals = {
  /** Generation calls (chat + stream), successful or not. */
  llmCalls: number;
  failedCalls: number;
  embeddingCalls: number;
  rerankCalls: number;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  /** Estimated USD at pricing.ts rates — an estimate, never a bill. */
  costUsd: number;
  /** Models that served calls but have no entry in pricing.ts (their cost is under-reported). */
  unpricedModels: string[];
  /** Calls per purpose, e.g. { answer: 1, judge: 2, condense: 1 }. */
  byPurpose: Record<string, number>;
  /** Phase 2.1: model-call time per purpose, ms (e.g. { answer: 5200, judge: 1900 }). */
  msByPurpose: Record<string, number>;
  /** Phase 2.1: wall time of the pipeline's own stages, ms (e.g. { retrieval: 140, grounding: 6 }). */
  stages: Record<string, number>;
  /** Distinct chat models used, in first-use order. */
  chatModels: string[];
  embeddingModel: string | null;
};

export class UsageMeter {
  readonly entries: MeterEntry[] = [];
  readonly stageMs: Record<string, number> = {};

  add(e: MeterEntry): void {
    this.entries.push(e);
  }

  /** Adds wall time to a named pipeline stage (retrieval, grounding, …). */
  stage(name: string, ms: number): void {
    this.stageMs[name] = (this.stageMs[name] ?? 0) + Math.max(0, Math.round(ms));
  }

  totals(): UsageTotals {
    const t: UsageTotals = {
      llmCalls: 0,
      failedCalls: 0,
      embeddingCalls: 0,
      rerankCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      embeddingTokens: 0,
      costUsd: 0,
      unpricedModels: [],
      byPurpose: {},
      msByPurpose: {},
      stages: { ...this.stageMs },
      chatModels: [],
      embeddingModel: null,
    };
    const unpriced = new Set<string>();
    for (const e of this.entries) {
      t.byPurpose[e.purpose] = (t.byPurpose[e.purpose] ?? 0) + 1;
      t.msByPurpose[e.purpose] = (t.msByPurpose[e.purpose] ?? 0) + Math.round(e.ms);
      if (!e.ok) t.failedCalls++;
      if (e.kind === "chat" || e.kind === "stream") {
        t.llmCalls++;
        t.tokensIn += e.tokensIn;
        t.tokensOut += e.tokensOut;
        if (!t.chatModels.includes(e.model)) t.chatModels.push(e.model);
      } else if (e.kind === "embed") {
        t.embeddingCalls++;
        t.embeddingTokens += e.tokensIn;
        t.embeddingModel = t.embeddingModel ?? e.model;
      } else {
        t.rerankCalls++;
      }
      if (e.kind !== "rerank" && e.ok && (e.tokensIn || e.tokensOut)) {
        if (!isPriced(e.model)) unpriced.add(e.model);
        t.costUsd += estimateCost(e.model, e.tokensIn, e.tokensOut);
      }
    }
    t.unpricedModels = [...unpriced];
    return t;
  }
}

/**
 * What every model call made on behalf of one request can see: the meter it
 * records into, and the request's abort signal — fired by the request's
 * overall deadline or by the client disconnecting — which the provider
 * wrappers pass down so an abandoned request stops paying for model calls.
 */
export type RequestScope = { meter: UsageMeter; signal?: AbortSignal };

const storage = new AsyncLocalStorage<RequestScope>();

/** The meter of the request this code runs in, if any. */
export function currentMeter(): UsageMeter | undefined {
  return storage.getStore()?.meter;
}

/** The abort signal of the request this code runs in, if any. */
export function currentSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

/** Runs `fn` in `scope` (including the callbacks and promises it starts). */
export function withRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** Times `fn` as a pipeline stage of the current request (no-op outside a request). */
export async function timeStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    currentMeter()?.stage(name, Date.now() - started);
  }
}

/** Convenience for callers that only meter (tests, scripts). */
export function withMeter<T>(meter: UsageMeter, fn: () => Promise<T>): Promise<T> {
  return storage.run({ meter }, fn);
}
