/**
 * The 3 files that neither the normal PDF pipeline nor its OCR fallback could
 * handle correctly:
 *   - منع الاتجار بالبشر 2009 (source 14): text-layer passed the garbled-text
 *     quality gate but produced 0 recognisable "المادة (N)" markers — a bidi
 *     ordering defect specific to this PDF (its own extracted text showed
 *     "( 1المادة )", number before the word, reversed from normal reading
 *     order), independent of letter-level quality.
 *   - قانون التنفيذ 2007 (source 15): OCR hard-caps at 40 pages; this document
 *     is 61 pages, so 21 pages (34%) were never read at all.
 *   - معدل لقانون الكاتب العدل 2026: a brand new 2026 amendment with no
 *     existing DB row at all; its own PDF has the same broken-font-glyph
 *     rendering seen throughout this session (a garbled duplicate text
 *     stream sits alongside a correctly-rendered one on every page).
 *
 * Fixed the same way حماية المستهلك was fixed earlier this project (see
 * [[amendment-linking-infra]]): read the PDF directly with Claude's own
 * vision-capable Read tool (not pdf-parse, not tesseract) and hand-transcribe
 * the clean, correctly-ordered text to a .txt file. extractDocument() treats
 * a .txt input as already-clean input — method becomes "text-layer", so
 * article numbers ARE trusted as citation data, which is justified here:
 * the numbering was read directly and cross-checked against each law's own
 * stated article count, not guessed the way tesseract's digit misreads are.
 * The known, already-disclosed residual limitation still applies — the
 * SOURCE PDF's own rendering carries letter-level noise in places even in
 * the correctly-ordered clean text, exactly like the civil code.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { query, queryOne } from "../src/lib/db";
import { ingestSource } from "../src/lib/ingest/pipeline";

const SCRATCH = "C:\\Users\\husse\\AppData\\Local\\Temp\\claude\\C--Users-husse-Desktop-Ai-legal\\77da35d3-6e3f-415c-a8a5-4bc8b071fe8f\\scratchpad";

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

async function supersede(existingId: number, txtFile: string, lawNumber: string | null, year: number | null, effectiveDate: string | null) {
  const old = await queryOne<ExistingSource>(
    `SELECT id, title, source_type, category, court, law_number, year, effective_date::text
       FROM legal_sources WHERE id = $1`,
    [existingId]
  );
  if (!old) throw new Error(`source ${existingId} not found`);

  const filePath = `${SCRATCH}\\${txtFile}`;
  const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");
  const finalLawNumber = lawNumber ?? old.law_number;
  const finalYear = year ?? old.year;
  const finalEffectiveDate = effectiveDate ?? old.effective_date;

  console.log(`\n${"=".repeat(90)}`);
  console.log(`${old.title}`);
  console.log(`  supersedes source [${old.id}]  law_number=${finalLawNumber}  year=${finalYear}  effective_date=${finalEffectiveDate}`);

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO legal_sources
       (title, source_type, category, court, year, law_number, effective_date, supersedes, file_path, file_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
    [old.title, old.source_type, old.category, old.court, finalYear, finalLawNumber, finalEffectiveDate, old.id, filePath, fileHash]
  );
  const newId = inserted!.id;

  const result = await ingestSource({
    sourceId: newId,
    filePath,
    title: old.title,
    sourceType: old.source_type,
    category: old.category,
    court: old.court,
    year: finalYear,
  });
  await query(`UPDATE legal_sources SET is_current_version = false, updated_at = now() WHERE id = $1`, [old.id]);
  console.log(`  ok — new source [${newId}]: ${result.chunks} chunks, ${result.pages} pages, method=${result.method}`);
  return newId;
}

async function insertNew(txtFile: string, title: string, lawNumber: string, year: number, amendmentOf: number) {
  const filePath = `${SCRATCH}\\${txtFile}`;
  const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");

  console.log(`\n${"=".repeat(90)}`);
  console.log(`${title}  (new — amends source [${amendmentOf}])`);

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO legal_sources
       (title, source_type, category, court, year, law_number, amendment_of, file_path, file_hash, status)
     VALUES ($1,'law',$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING id`,
    [title, "حقوقية", null, year, lawNumber, amendmentOf, filePath, fileHash]
  );
  const newId = inserted!.id;

  const result = await ingestSource({
    sourceId: newId,
    filePath,
    title,
    sourceType: "law",
    category: "حقوقية",
    court: null,
    year,
  });
  console.log(`  ok — new source [${newId}]: ${result.chunks} chunks, ${result.pages} pages, method=${result.method}`);
  return newId;
}

async function main() {
  await supersede(14, "human-trafficking-2009.txt", "9", 2009, "2009-03-31");
  await supersede(15, "execution-law-2007.txt", "25", 2007, "2007-06-15");
  await insertNew("notary-amendment-2026.txt", "قانون معدل لقانون الكاتب العدل رقم 3 لسنة 2026", "3", 2026, 177);

  console.log(`\n${"=".repeat(90)}\n  done\n${"=".repeat(90)}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
