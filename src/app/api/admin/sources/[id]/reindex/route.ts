import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { reindexSource } from "@/lib/ingest/pipeline";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST — re-runs extraction + chunking + embeddings for one source. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "معرّف غير صالح." }, { status: 400 });

  try {
    const result = await reindexSource(id);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشلت إعادة الفهرسة.";
    logError("[admin/reindex] failed:", err);
    return Response.json({ error: message }, { status: 400 });
  }
}
