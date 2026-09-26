import "server-only";

/**
 * Deadlines and retry policy for every external AI call.
 *
 * RETRY POLICY (Phase 2)
 *   chat / generation  — NEVER retried automatically. A generation is
 *                        expensive and not idempotent: a hidden retry doubles
 *                        cost without appearing in usage. (The SDKs retried
 *                        twice by default, with a 10-minute timeout.) The
 *                        pipeline's own bounded, accounted re-generations
 *                        (false-refusal retry, one repair) are explicit.
 *   embeddings         — retried ONCE on 429 / 5xx / network error: cheap,
 *                        idempotent, and a transient failure there would
 *                        otherwise fail the whole question.
 *   rerank             — not retried; on failure retrieval falls back to the
 *                        un-reranked order (search/hybrid.ts).
 */

export class AiTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`);
    this.name = "AiTimeoutError";
  }
}

/** Rejects with AiTimeoutError if `promise` has not settled within `ms`; aborts `ctrl` when it fires. */
export async function withDeadline<T>(what: string, ms: number, ctrl: AbortController, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new AiTimeoutError(what, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps a stream so that silence longer than `idleMs` between items aborts it
 * (via `abort`) and throws AiTimeoutError, and so that the whole stream cannot
 * outlive `totalMs`. A stalled upstream must never hold a request forever.
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  opts: { idleMs: number; totalMs: number; what: string; abort: () => void }
): AsyncGenerator<T, void, void> {
  const iterator = source[Symbol.asyncIterator]();
  const started = Date.now();
  for (;;) {
    const remainingTotal = opts.totalMs - (Date.now() - started);
    const wait = Math.max(1, Math.min(opts.idleMs, remainingTotal));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        opts.abort();
        reject(new AiTimeoutError(opts.what, remainingTotal <= opts.idleMs ? opts.totalMs : opts.idleMs));
      }, wait);
    });
    let next: IteratorResult<T>;
    try {
      next = await Promise.race([iterator.next(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (next.done) return;
    yield next.value;
  }
}

/** HTTP statuses worth one retry for an idempotent call. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500 && status < 600);
}
