import "server-only";
import { SOURCE_TYPES, type SourceType } from "./classify";
import { isAmendingTitle } from "./law-identity";

/**
 * Pre-ingest validation gate.
 *
 * WHY THIS EXISTS
 *
 * The knowledge base is only trustworthy if every legislative source carries
 * the identity a lawyer cites by — name, number, year, kind, and the date it
 * took effect. A law ingested without its number is unfindable by the query
 * that should return it ("قانون العمل رقم 8") and uncitable in a drafted
 * document. And an amending act ingested with no link to the law it amends
 * produces the citation-collision described in schema.sql: the original and
 * amended text of one article, retrieved together, with nothing marking which
 * is in force.
 *
 * So this runs before the file is embedded, at every ingest entry point (the
 * admin upload route and the bulk-ingest CLI). It is a pure function — no DB,
 * no API — so it is covered by verify-pipeline.ts and cannot be silently
 * skipped. Errors are Arabic because they surface directly to the admin.
 *
 * WHAT IS AND ISN'T REQUIRED
 *
 * Legislation (law | regulation | instruction) must carry the full identity.
 * A court decision, a legal principle, and a drafting template are NOT
 * legislation: they have no "law number" or "effective date", so requiring
 * those of them would be wrong. They still need a title and a valid type.
 */

export type SourceMetadataInput = {
  title?: string | null;
  sourceType?: string | null;
  lawNumber?: string | null;
  year?: number | null;
  /** ISO date string (YYYY-MM-DD) or null. */
  effectiveDate?: string | null;
  /** id of the base law this one amends, when it is an amendment. */
  amendmentOf?: number | null;
};

export type ValidationResult = {
  ok: boolean;
  /** Human-readable Arabic messages, one per failed requirement. */
  errors: string[];
};

const LEGISLATION: SourceType[] = ["law", "regulation", "instruction"];

const KIND_LABEL: Record<string, string> = {
  law: "القانون",
  regulation: "النظام",
  instruction: "التعليمات",
  court_decision: "القرار",
  principle: "المبدأ",
  template: "القالب",
};

const CURRENT_YEAR = new Date().getFullYear();

function isValidIsoDate(s: string): boolean {
  // Shape first, then a real calendar check (rejects 2024-02-31).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  if (y < 1900 || y > CURRENT_YEAR + 1) return false;
  // Round-trips only if the day actually exists in that month.
  return d.toISOString().slice(0, 10) === s;
}

/**
 * Validates a source's metadata for ingest. Returns every problem at once
 * rather than the first, so the admin fixes the form in one pass.
 */
export function validateSourceMetadata(input: SourceMetadataInput): ValidationResult {
  const errors: string[] = [];

  const title = (input.title ?? "").trim();
  const sourceType = (input.sourceType ?? "").trim();

  // ---- required of every source ----
  if (!title) errors.push("اسم القانون (العنوان) مطلوب.");

  if (!sourceType) {
    errors.push("نوع القانون مطلوب.");
  } else if (!SOURCE_TYPES.includes(sourceType as SourceType)) {
    errors.push(`نوع القانون غير صالح. يجب أن يكون أحد: ${SOURCE_TYPES.join("، ")}.`);
  }

  // Everything below is a legislation-only requirement. Bail out early for
  // non-legislation (or an unknown type) so we don't stack irrelevant errors.
  if (!LEGISLATION.includes(sourceType as SourceType)) {
    return { ok: errors.length === 0, errors };
  }

  const label = KIND_LABEL[sourceType] ?? "القانون";

  // ---- required of legislation ----
  if (!input.lawNumber || !String(input.lawNumber).trim()) {
    errors.push(`رقم ${label} مطلوب (مثال: 8 في "قانون العمل رقم 8 لسنة 1996").`);
  } else if (!/^\d{1,5}(?:\s*مكرر)?$/.test(normalize(input.lawNumber))) {
    errors.push(`رقم ${label} غير صالح: "${input.lawNumber}".`);
  }

  if (input.year === null || input.year === undefined) {
    errors.push(`سنة ${label} مطلوبة (لسنة …).`);
  } else if (!Number.isInteger(input.year) || input.year < 1900 || input.year > CURRENT_YEAR + 1) {
    errors.push(`سنة ${label} غير صالحة: ${input.year}.`);
  }

  if (!input.effectiveDate || !String(input.effectiveDate).trim()) {
    errors.push(`تاريخ نفاذ ${label} مطلوب (بصيغة YYYY-MM-DD).`);
  } else if (!isValidIsoDate(String(input.effectiveDate).trim())) {
    errors.push(`تاريخ النفاذ غير صالح: "${input.effectiveDate}" — استخدم صيغة YYYY-MM-DD.`);
  }

  // ---- amendment must be linked ----
  // This is the "منع إدخال نسخ متعارضة بدون ربط" rule. A title that names an
  // amending act ("قانون معدّل لقانون …") with no amends_source_id would sit in
  // the corpus as an unlinked duplicate of the law it modifies. Refuse it here
  // and tell the admin to pick the base law.
  if (isAmendingTitle(title) && (input.amendmentOf === null || input.amendmentOf === undefined)) {
    errors.push(
      `هذا قانون معدّل، ويجب ربطه بالقانون الأصلي الذي يعدّله (حقل "يعدّل القانون"). ` +
        `الإدخال بلا ربط يُنتج نسخة متعارضة غير مرتبطة في قاعدة البيانات.`
    );
  }

  return { ok: errors.length === 0, errors };
}

function normalize(s: string): string {
  return String(s)
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
