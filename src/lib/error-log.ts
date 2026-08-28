import "server-only";
import { query } from "./db";

/**
 * Drop-in replacement for `console.error(context, detail)` — logs to the
 * console exactly as before, and best-effort persists the same information to
 * error_log so an unexpected failure shows up on the admin dashboard instead
 * of requiring someone to watch server logs live to notice it.
 *
 * Fire-and-forget, and the DB write is wrapped in its own catch: if the
 * database itself is the thing that's down (the error being logged might
 * BE that outage), the console.error above already recorded it, and this
 * must never throw back into the caller on top of the original failure.
 */
export function logError(context: string, detail: unknown): void {
  console.error(context, detail);

  const err = detail instanceof Error ? detail : undefined;
  const message = err ? err.message : String(detail);
  const stack = err?.stack ?? null;

  void query(`INSERT INTO error_log (context, message, stack) VALUES ($1, $2, $3)`, [
    context,
    message,
    stack,
  ]).catch((e) => console.error("[error-log] failed to persist error:", (e as Error).message));
}
