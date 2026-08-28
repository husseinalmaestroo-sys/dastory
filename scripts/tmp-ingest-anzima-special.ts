/**
 * The 3 الأنظمة/ files that needed individual handling instead of the
 * standard supersession batch:
 *   - نظام رسوم الكاتب العدل 2026 (supersede source 68): its own OCR pass
 *     came back garbled=true (worse than the current source's OCR) — fixed
 *     via the same vision-transcription fallback used earlier today.
 *   - قرار بتحديد الصحف الاوسع انتشاراً... 2021: no existing match, new
 *     'instruction' source. Its own extraction (OCR, not garbled) was
 *     already usable, no vision fix needed.
 *   - لائحة أجور أتعاب الكاتب العدل المرخص لسنة 2015: no existing match, new
 *     'regulation' source. Clean text-layer extraction already, no fix
 *     needed either.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query, queryOne } from "../src/lib/db";
import { ingestSource } from "../src/lib/ingest/pipeline";

const SCRATCH = "C:\\Users\\husse\\AppData\\Local\\Temp\\claude\\C--Users-husse-Desktop-Ai-legal\\77da35d3-6e3f-415c-a8a5-4bc8b071fe8f\\scratchpad";
const FOLDER = join(process.cwd(), "الأنظمة");

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

async function supersedeFromScratch(existingId: number, txtFile: string, lawNumber: string | null, year: number | null) {
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

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO legal_sources
       (title, source_type, category, court, year, law_number, effective_date, supersedes, file_path, file_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
    [old.title, old.source_type, old.category, old.court, finalYear, finalLawNumber, old.effective_date, old.id, filePath, fileHash]
  );
  const newId = inserted!.id;
  const result = await ingestSource({
    sourceId: newId, filePath, title: old.title, sourceType: old.source_type, category: old.category, court: old.court, year: finalYear,
  });
  await query(`UPDATE legal_sources SET is_current_version = false, updated_at = now() WHERE id = $1`, [old.id]);
  console.log(`PROGRESS ok [${old.id}→${newId}] ${old.title.slice(0, 60)} — ${result.chunks} chunks, ${result.pages} pages, ${result.method} (vision-transcribed)`);
}

async function insertNewFromPdf(pdfFile: string, title: string, sourceType: "instruction" | "regulation", year: number) {
  const filePath = join(FOLDER, pdfFile);
  const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO legal_sources (title, source_type, year, file_path, file_hash, status)
     VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id`,
    [title, sourceType, year, filePath, fileHash]
  );
  const newId = inserted!.id;
  const result = await ingestSource({ sourceId: newId, filePath, title, sourceType, year });
  console.log(`PROGRESS ok [new→${newId}] ${title.slice(0, 60)} — ${result.chunks} chunks, ${result.pages} pages, ${result.method}`);
}

async function main() {
  await supersedeFromScratch(68, "notary-fees-2026.txt", "14", 2026);
  await insertNewFromPdf(
    "قرار_بتحديد_الصحف_الاوسع_انتشارا_لنشر_الاعلانات_والتبليغات_القضائية_لسنة_2021.pdf",
    "قرار بتحديد الصحف الاوسع انتشارا لنشر الاعلانات والتبليغات القضائية لسنة 2021",
    "instruction",
    2021
  );
  await insertNewFromPdf(
    "لائحة_أجور_أتعاب_الكاتب_العدل_المرخص_لسنة_2015.pdf",
    "لائحة أجور أتعاب الكاتب العدل المرخص لسنة 2015",
    "regulation",
    2015
  );
  console.log("PROGRESS DONE special-case batch complete");
  process.exit(0);
}

main().catch((err) => {
  console.log(`PROGRESS FATAL ${err.message}`);
  process.exit(1);
});
