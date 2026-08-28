/**
 * Second supersession batch: 7 of the 11 files tmp-supersede-batch.ts
 * originally excluded. A title-substring DB search (not the original
 * law_number-only matcher) confirmed each has a correct, unambiguous
 * existing target. Metadata is inherited from the existing row (title,
 * category, court, effective_date) exactly like the first batch — only the
 * cleanly-parsed text-layer file (اصول المحاكمات الجزائية) gets its
 * effective_date from its own header, since it's the only one whose header
 * OCR didn't garble the digits.
 *
 * The other 4 of the 11 are handled separately:
 *   - قانون التنفيذ 2007 / منع الاتجار بالبشر 2009 / معدل لقانون الكاتب
 *     العدل: OCR truncates or a bidi-order bug defeats article detection
 *     even on a clean text-layer — handled via Claude's own vision-based
 *     PDF reading instead (already proven for حماية المستهلك), not this
 *     script.
 *   - قانون العقوبات 1960: re-download OCR-truncates at 40/223 pages and
 *     its target (source 3) is already inactive with a clean current
 *     replacement at source 170 — no value in ingesting it. Skipped
 *     entirely, not attempted here.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { query, queryOne } from "../src/lib/db";
import { ingestSource } from "../src/lib/ingest/pipeline";

type ExistingSource = {
  id: number;
  title: string;
  source_type: string;
  category: string | null;
  court: string | null;
  law_number: string | null;
  year: number | null;
  effective_date: string | null;
};

type BatchItem = {
  file: string;
  existingId: number;
  // null = inherit from the existing row rather than override.
  effectiveDate: string | null;
};

const BATCH: BatchItem[] = [
  { file: "قانون_اصول_المحاكمات_الجزائية_وتعديلاته_رقم_9_لسنة_1961.pdf", existingId: 24, effectiveDate: "1961-04-16" },
  { file: "قانون_مراكز_الاصلاح_والتأهيل_وتعديلاته_رقم_9_لسنة_2004.pdf", existingId: 21, effectiveDate: null },
  { file: "قانون_معدل_لقانون_التنفيذ_رقم_9_لسنة_2022.pdf", existingId: 18, effectiveDate: null },
  { file: "قانون_معدل_لقانون_العقوبات_2025.pdf", existingId: 7, effectiveDate: null },
  { file: "معدل_لقانون_المعاملات_الالكترونية.pdf", existingId: 5, effectiveDate: null },
  { file: "قانــــــون_العفو_العام_رقـم_5_لسنـــــــــــــة_2024.pdf", existingId: 22, effectiveDate: null },
  { file: "قانون_الكسب_غير_المشروع_وتعديلاته_رقم_21_لسنة_2014.pdf", existingId: 19, effectiveDate: null },
];

async function main() {
  const folder = join(process.cwd(), "القوانين");
  let ok = 0;
  let failed = 0;

  for (const b of BATCH) {
    const old = await queryOne<ExistingSource>(
      `SELECT id, title, source_type, category, court, law_number, year, effective_date::text
         FROM legal_sources WHERE id = $1`,
      [b.existingId]
    );
    console.log(`\n${"=".repeat(90)}`);
    if (!old) {
      console.error(`  ! existing source ${b.existingId} not found — skipping ${b.file}`);
      failed++;
      continue;
    }

    const filePath = join(folder, b.file);
    const effectiveDate = b.effectiveDate ?? old.effective_date;
    const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");

    console.log(`${old.title}`);
    console.log(`  supersedes source [${old.id}]  law_number=${old.law_number}  year=${old.year}  effective_date=${effectiveDate}`);

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO legal_sources
         (title, source_type, category, court, year, law_number, effective_date, supersedes, file_path, file_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
      [old.title, old.source_type, old.category, old.court, old.year, old.law_number, effectiveDate, old.id, filePath, fileHash]
    );
    const newId = inserted!.id;

    try {
      const result = await ingestSource({
        sourceId: newId,
        filePath,
        title: old.title,
        sourceType: old.source_type,
        category: old.category,
        court: old.court,
        year: old.year,
      });
      await query(`UPDATE legal_sources SET is_current_version = false, updated_at = now() WHERE id = $1`, [old.id]);
      ok++;
      console.log(`  ok — new source [${newId}]: ${result.chunks} chunks, ${result.pages} pages, method=${result.method}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${(err as Error).message}`);
      console.error(`  source [${old.id}] left as the current version; failed attempt is source [${newId}] (status='failed').`);
    }
  }

  console.log(`\n${"=".repeat(90)}`);
  console.log(`  ${ok} superseded, ${failed} failed, of ${BATCH.length} planned`);
  console.log(`${"=".repeat(90)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
