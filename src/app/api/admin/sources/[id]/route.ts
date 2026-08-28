import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — edit source metadata. Does not re-embed; use /reindex for that. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "معرّف غير صالح." }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "طلب غير صالح." }, { status: 400 });

  const fields: string[] = [];
  const values: unknown[] = [id];

  // Allowlist. Interpolating client-supplied keys into SQL would let a caller
  // rewrite any column, including status. law_number / effective_date /
  // amends_source_id / is_in_force are here so an admin can fix a law's
  // citation identity or version link without re-uploading and re-embedding.
  const allowed = [
    "title",
    "category",
    "court",
    "year",
    "law_number",
    "effective_date",
    "amendment_of",
    "supersedes",
    "is_current_version",
  ] as const;
  for (const key of allowed) {
    if (body[key] !== undefined) {
      values.push(body[key] === "" ? null : body[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }

  if (fields.length === 0) return Response.json({ error: "لا يوجد تعديل." }, { status: 400 });

  const row = await queryOne(
    `UPDATE legal_sources SET ${fields.join(", ")}, updated_at = now()
      WHERE id = $1
      RETURNING id, title, source_type, category, court, year, law_number, effective_date,
                amendment_of, supersedes, is_current_version, status, chunk_count`,
    values
  );
  if (!row) return Response.json({ error: "المصدر غير موجود." }, { status: 404 });

  // Keep the denormalised copies on the chunks in step, otherwise a filtered
  // search would still match the old values.
  await query(
    `UPDATE legal_documents SET category = COALESCE($2, category), court = COALESCE($3, court)
      WHERE source_id = $1`,
    [id, body.category ?? null, body.court ?? null]
  );

  return Response.json({ source: row });
}

/** DELETE — removes the source; chunks and cases cascade via FK. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return Response.json({ error: "معرّف غير صالح." }, { status: 400 });

  const row = await queryOne<{ id: number; file_path: string | null }>(
    `DELETE FROM legal_sources WHERE id = $1 RETURNING id, file_path`,
    [id]
  );
  if (!row) return Response.json({ error: "المصدر غير موجود." }, { status: 404 });

  // The PDF stays on disk on purpose: the DB row is gone, but if this delete
  // was a mistake the original is still recoverable. Reap old files separately.
  return Response.json({ ok: true, id: row.id });
}
