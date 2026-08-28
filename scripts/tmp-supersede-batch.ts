/**
 * One-off supersession ingest for the 13 files (of 24 downloaded from
 * moj.gov.jo into القوانين/) that scripts/tmp-plan-supersession.ts confirmed
 * are BOTH a correct match to an existing legal_sources row AND a clean
 * extraction (text-layer, not garbled, no OCR truncation).
 *
 * The other 11 files are deliberately EXCLUDED from this batch:
 *   - 3 files matched the WRONG existing source: tmp-plan-supersession.ts's
 *     matcher accepts a law_number match regardless of year, so three
 *     unrelated "رقم 9" laws (اصول المحاكمات الجزائية 1961, مراكز الاصلاح
 *     2004, معدل لقانون التنفيذ 2022) all falsely matched source [14]
 *     (منع الاتجار بالبشر رقم 9 لسنة 2009). A 4th (معدل لقانون العقوبات
 *     2025) falsely matched source [36] via the loose title-substring
 *     fallback. Superseding on a wrong match would bury a CORRECT existing
 *     source under an UNRELATED law's text — worse than doing nothing.
 *   - قانون العقوبات 1960 (source [3], already is_current_version=false):
 *     OCR capped at 40 of 223 pages, only 29 distinct articles recovered.
 *     Source [3] is already inert (a clean current replacement exists);
 *     ingesting a 13%-complete OCR pass over an already-dead row has no
 *     upside and is skipped entirely.
 *   - منع الاتجار بالبشر 2009 (source [14], the one file that DID match
 *     its own correct source): text-layer passed the garbled-text quality
 *     gate but produced 0 distinct article numbers — a silent chunking
 *     failure independent of letter-level corruption. Ingesting it would
 *     replace a citable source with an uncitable one.
 *   - قانون التنفيذ 2007 (source [15]): OCR capped at 40 of 61 pages (66%).
 *   - قانون الجمعيات's OCR fallback never triggered (its own text-layer
 *     passed clean) so it IS included below; قانون العفو العام 2024 and
 *     قانون الكسب غير المشروع 2014 are borderline OCR results (low article
 *     counts, no confirmed corruption) left OUT of this automated batch for
 *     a human spot-check rather than a guess.
 *   - معدل لقانون الكاتب العدل and معدل لقانون المعاملات الالكترونية: no
 *     confident existing-source match at all (title carries no law number).
 *
 * Each entry supersedes an EXISTING source: the old row is flipped to
 * is_current_version=false, a new row is inserted with supersedes=<old id>,
 * and ingestSource() runs the real extract→chunk→embed pipeline against the
 * new row. If ingestSource throws, the old row is flipped back to current
 * so a failed attempt never leaves the corpus with NO current version.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-supersede-batch.ts
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
  effective_date: string | null;
};

type BatchItem = {
  file: string;
  existingId: number;
  lawNumber: string;
  year: number;
  // null = header didn't carry a usable date for this file; inherit the
  // existing (already-validated) source's own effective_date instead of
  // guessing one.
  effectiveDate: string | null;
};

const BATCH: BatchItem[] = [
  { file: "القانون_المدني_رقم_43_لسنة_1976.pdf", existingId: 2, lawNumber: "43", year: 1976, effectiveDate: "1977-01-01" },
  { file: "قانون_إدارة_قضايا_الدولة_وتعديلاته_رقم_28_لسنة_2017.pdf", existingId: 17, lawNumber: "28", year: 2017, effectiveDate: "2017-12-28" },
  { file: "قانون_استقلال_القضاء_وتعديلاته_رقم_29_لسنة_2014.pdf", existingId: 8, lawNumber: "29", year: 2014, effectiveDate: "2014-10-16" },
  { file: "قانون_اصول_المحاكمات_المدنية_وتعديلاته_رقم_24_لسنة_1988.pdf", existingId: 25, lawNumber: "24", year: 1988, effectiveDate: "1988-07-31" },
  { file: "قانون_الجمعيات_وتعديلاته_رقم_51_لسنة_2008.pdf", existingId: 13, lawNumber: "51", year: 2008, effectiveDate: "2008-12-15" },
  { file: "قانون_الكاتب_العدل_وتعديلاته_رقم_11_لسنة_1952.pdf", existingId: 16, lawNumber: "11", year: 1952, effectiveDate: "1952-04-01" },
  { file: "قانون_الوساطة_لتسوية_النزاعات_المدنية_وتعديلاته_رقم_12_لسنة_2006.pdf", existingId: 10, lawNumber: "12", year: 2006, effectiveDate: "2006-03-16" },
  { file: "قانون_تشكيل_المحاكم_النظامية_وتعديلاته_رقم_17_لسنة_2001.pdf", existingId: 23, lawNumber: "17", year: 2001, effectiveDate: "2001-04-17" },
  { file: "قانون_ضمان_حق_الحصول_على_المعلومات_رقم_47_لسنة_2007.pdf", existingId: 11, lawNumber: "47", year: 2007, effectiveDate: "2007-06-17" },
  { file: "قانون_معدل_لقانون_أصول_المحاكمات_المدنية_رقم_6_لسنة_2024.pdf", existingId: 4, lawNumber: "6", year: 2024, effectiveDate: null },
  { file: "قانون_معدل_لقانون_اصول_المحاكمات_المدنية_رقم_14_لسنة_2023.pdf", existingId: 20, lawNumber: "14", year: 2023, effectiveDate: null },
  { file: "قانون_معدل_لقانون_العقوبات_رقم_10_لسنة_2022.pdf", existingId: 6, lawNumber: "10", year: 2022, effectiveDate: null },
  { file: "قانون_معدل_لقانون_ضمان_ق_الحصول_على_المعلومات_رقم_3_لسنة_2024.pdf", existingId: 12, lawNumber: "3", year: 2024, effectiveDate: null },
];

async function main() {
  const folder = join(process.cwd(), "القوانين");
  let ok = 0;
  let failed = 0;

  for (const b of BATCH) {
    const old = await queryOne<ExistingSource>(
      `SELECT id, title, source_type, category, court, effective_date::text
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
    console.log(`  supersedes source [${old.id}]  law_number=${b.lawNumber}  year=${b.year}  effective_date=${effectiveDate}`);

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO legal_sources
         (title, source_type, category, court, year, law_number, effective_date, supersedes, file_path, file_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
      [old.title, old.source_type, old.category, old.court, b.year, b.lawNumber, effectiveDate, old.id, filePath, fileHash]
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
        year: b.year,
      });
      // Only retire the old version once the new one is confirmed ready —
      // never leave a window where BOTH or NEITHER is current.
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
