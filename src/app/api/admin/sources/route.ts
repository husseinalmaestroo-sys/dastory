import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { query, queryOne } from "@/lib/db";
import { savePdf } from "@/lib/storage";
import { ingestSource } from "@/lib/ingest/pipeline";
import { validateSourceMetadata } from "@/lib/ingest/validate";
import { logError } from "@/lib/error-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // OCR + embedding a full law takes minutes.

/**
 * GET /api/admin/sources — list for the admin table.
 * GET /api/admin/sources?bases=1 — just the original (non-amending) laws, for
 * the "يعدّل القانون" dropdown when uploading an amendment. Returned smallest
 * payload that lets the admin link a new amendment to its base.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (req.nextUrl.searchParams.get("bases") === "1") {
    const bases = await query(
      `SELECT id, title, law_number, year
         FROM legal_sources
        WHERE source_type IN ('law','regulation','instruction')
          AND amendment_of IS NULL
        ORDER BY title`
    );
    return Response.json({ bases });
  }

  const rows = await query(
    `SELECT id, title, source_type, category, court, year, law_number, effective_date,
            amendment_of, supersedes, is_current_version, status, error, note, chunk_count, created_at,
            provenance, integrity_status, integrity_note, gazette_status, gazette_reference
       FROM legal_sources ORDER BY created_at DESC LIMIT 500`
  );
  return Response.json({ sources: rows });
}

/** POST /api/admin/sources — upload a PDF and ingest it. */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "طلب غير صالح." }, { status: 400 });

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const sourceType = String(form.get("source_type") ?? "").trim();
  const category = str(form.get("category"));
  const court = str(form.get("court"));
  const yearRaw = str(form.get("year"));
  const lawNumber = str(form.get("law_number"));
  const effectiveDate = str(form.get("effective_date"));
  const amendmentRaw = str(form.get("amendment_of"));
  const supersedesRaw = str(form.get("supersedes"));

  if (!(file instanceof File)) return Response.json({ error: "لم يتم إرفاق ملف." }, { status: 400 });

  const year = yearRaw ? Number(yearRaw) : null;
  const amendmentOf = amendmentRaw ? Number(amendmentRaw) : null;
  const supersedes = supersedesRaw ? Number(supersedesRaw) : null;
  if (amendmentRaw && !Number.isInteger(amendmentOf)) {
    return Response.json({ error: "معرّف القانون الأصلي غير صالح." }, { status: 400 });
  }
  if (supersedesRaw && !Number.isInteger(supersedes)) {
    return Response.json({ error: "معرّف النسخة السابقة غير صالح." }, { status: 400 });
  }

  // One validation gate for everything the citation identity needs — name,
  // number, year, type, effective date, and the amendment link. Same pure
  // function the bulk-ingest CLI uses, so the rule cannot drift between paths.
  const check = validateSourceMetadata({
    title,
    sourceType,
    lawNumber,
    year,
    effectiveDate,
    amendmentOf,
  });
  if (!check.ok) {
    return Response.json({ error: check.errors.join(" ") }, { status: 400 });
  }

  // The linked base must actually exist and be a base law, or the link is a
  // dangling reference that breaks the version stack.
  if (amendmentOf !== null) {
    const base = await queryOne<{ id: number; amendment_of: number | null }>(
      `SELECT id, amendment_of FROM legal_sources WHERE id = $1`,
      [amendmentOf]
    );
    if (!base) return Response.json({ error: "القانون الأصلي المُشار إليه غير موجود." }, { status: 400 });
    if (base.amendment_of !== null) {
      return Response.json(
        { error: "لا يمكن الربط بقانون معدّل — اختر القانون الأصلي (الأساسي)، لا تعديلاً آخر." },
        { status: 400 }
      );
    }
  }

  // A superseded version must exist too. Marking THIS row as the newer version
  // also means the one it supersedes is no longer current — flip it below.
  if (supersedes !== null) {
    const prev = await queryOne<{ id: number }>(`SELECT id FROM legal_sources WHERE id = $1`, [supersedes]);
    if (!prev) return Response.json({ error: "النسخة السابقة المُشار إليها غير موجودة." }, { status: 400 });
  }

  let sourceId: number | null = null;
  try {
    const saved = await savePdf(file, "sources");

    // Refuse a duplicate before embedding it: re-indexing identical bytes is
    // pure spend for zero retrieval benefit, and it puts the same text in the
    // results twice, crowding out other authorities.
    const dupe = await queryOne<{ id: number; title: string }>(
      `SELECT id, title FROM legal_sources WHERE file_hash = $1 AND status = 'ready'`,
      [saved.hash]
    );
    if (dupe) {
      return Response.json(
        { error: `هذا الملف مفهرس مسبقاً تحت العنوان: "${dupe.title}". استخدم "إعادة فهرسة" إن أردت تحديثه.`, id: dupe.id },
        { status: 409 }
      );
    }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO legal_sources
         (title, source_type, category, court, year, law_number, effective_date, amendment_of, supersedes,
          file_path, file_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING id`,
      [title, sourceType, category, court, year, lawNumber, effectiveDate, amendmentOf, supersedes, saved.path, saved.hash]
    );
    sourceId = row!.id;

    // Publishing a new version retires the one it supersedes: the older row
    // stays in the corpus (history) but leaves the default, current-only
    // results. Done in code — the retrieval layer never guesses which is live.
    if (supersedes !== null) {
      await query(`UPDATE legal_sources SET is_current_version = false, updated_at = now() WHERE id = $1`, [supersedes]);
    }

    // Synchronous ingest: a job queue is the right answer at scale, but it
    // means Redis + a worker process on a box that has 4GB total. For an MVP
    // where the admin uploads a handful of laws by hand, blocking the request
    // and showing the real result beats the infrastructure.
    const result = await ingestSource({
      sourceId,
      filePath: saved.path,
      title,
      sourceType,
      category,
      court,
      year,
    });

    return Response.json({ id: sourceId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل رفع المصدر.";
    logError("[admin/sources] ingest failed:", err);
    // The row survives with status='failed' so the admin can see why and retry
    // from the table rather than re-uploading blind.
    return Response.json({ error: message, id: sourceId }, { status: 400 });
  }
}

function str(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}
