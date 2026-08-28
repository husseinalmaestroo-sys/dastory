import "dotenv/config";
import { readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { query } from "../src/lib/db";
import { extractDocument } from "../src/lib/ingest/extract";
import { assessArabicText } from "../src/lib/ingest/quality";
import { parseLawNumber, parseLawYear } from "../src/lib/ingest/law-identity";
import { chunkLegalText } from "../src/lib/ingest/chunk";

type ExistingSource = { id: number; title: string; law_number: string | null; year: number | null; is_current_version: boolean; source_type: string };

function parseHeaderField(text: string, label: string): string | null {
  // moj.gov.jo PDFs open with a standard header block:
  // "السنة : 1976" / "تاريخ السريان : 1977-01-01" / "قانون رقم 43 لسنة 1976"
  const re = new RegExp(`${label}\\s*:\\s*([\\d\\-]+)`);
  const m = text.slice(0, 600).match(re);
  return m ? m[1].trim() : null;
}

async function main() {
  const folder = join(process.cwd(), "القوانين");
  const files = (await readdir(folder)).filter((f) => extname(f).toLowerCase() === ".pdf");

  const existing = await query<ExistingSource>(
    `SELECT id, title, law_number, year, is_current_version, source_type
       FROM legal_sources WHERE source_type IN ('law','regulation','instruction')`
  );

  console.log(`${files.length} PDF(s) in القوانين/, ${existing.length} existing law/regulation/instruction source(s) in the DB.\n`);

  for (const f of files) {
    const title = basename(f, ".pdf").replace(/_/g, " ").trim();
    const filePath = join(folder, f);

    const titleLawNumber = parseLawNumber(title);
    const titleYear = parseLawYear(title);

    const t0 = Date.now();
    const extracted = await extractDocument(filePath);
    const quality = assessArabicText(extracted.text);
    const chunks = chunkLegalText(extracted.text, { sourceType: "law" });
    const distinctArticles = new Set(chunks.map((c) => c.articleNumber).filter(Boolean)).size;

    const headerYear = parseHeaderField(extracted.text, "السنة");
    const headerEffectiveDate = parseHeaderField(extracted.text, "تاريخ السريان");
    const headerLawNumber = extracted.text.slice(0, 600).match(/(?:قانون|نظام|تعليمات)\s*رقم\s*\(?\s*(\d+)/)?.[1] ?? null;

    // Match against an existing source: prefer law_number match, fall back to
    // a loose title-substring match for cases where the number isn't parsed
    // the same way on both sides (e.g. the historical row predates a number).
    const numMatch = existing.find((e) => e.law_number && (e.law_number === titleLawNumber || e.law_number === headerLawNumber));
    const titleWords = title.replace(/(قانون|نظام|تعليمات|معدل|وتعديلاته|رقم|\d+|لسنة|لعام)/g, "").trim();
    const looseMatch = !numMatch
      ? existing.find((e) => e.title.includes(titleWords.slice(0, 15)) || titleWords.includes(e.title.slice(0, 15)))
      : null;
    const match = numMatch ?? looseMatch;

    console.log(`${"=".repeat(90)}`);
    console.log(`FILE: ${f}`);
    console.log(`  title (from filename): ${title}`);
    console.log(`  parsed from TITLE  → law_number=${titleLawNumber}  year=${titleYear}`);
    console.log(`  parsed from HEADER → law_number=${headerLawNumber}  year=${headerYear}  effective_date=${headerEffectiveDate}`);
    console.log(
      `  extraction: method=${extracted.method}  pages=${extracted.pages}  chunks=${chunks.length}  distinct_articles=${distinctArticles}  ` +
        `garbled=${quality.garbled}  orphan_ratio=${(quality.orphanLetterRatio * 100).toFixed(2)}%  (${Date.now() - t0}ms)`
    );
    if (match) {
      console.log(`  → MATCHES existing source [${match.id}] "${match.title}" (current=${match.is_current_version}) — would SUPERSEDE`);
    } else {
      console.log(`  → NO existing match found — would be a NEW source, not a supersession`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
