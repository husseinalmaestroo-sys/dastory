import "server-only";

/**
 * Reads a request body up to `maxBytes`, as bytes. The service assertion
 * (service-auth.ts) is bound to the exact body, so routes read it once, raw,
 * verify, and only then parse. A body over the cap is refused before it is
 * buffered whole (413), so an oversized upload cannot exhaust memory.
 */
export async function readBodyLimited(req: Request, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: Response }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: Response.json({ error: "حجم الطلب أكبر من المسموح." }, { status: 413 }) };
  }
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, response: Response.json({ error: "حجم الطلب أكبر من المسموح." }, { status: 413 }) };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.byteLength;
  }
  return { ok: true, bytes };
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** True when the caller asked for one JSON response instead of the SSE stream. */
export function wantsJson(req: Request): boolean {
  return (req.headers.get("accept") ?? "").includes("application/json");
}
