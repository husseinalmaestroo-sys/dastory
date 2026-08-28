/**
 * الأنظمة/ batch: 31 of the 35 files matched an existing source with 100%
 * title-similarity confidence (tmp-plan-anzima.ts). Excluded from this run:
 *   - نظام رسوم الكاتب العدل 2026 (target [68]): its OWN OCR pass came back
 *     garbled=true — worse than the OCR the source already has. Needs the
 *     vision-transcription fallback instead, handled separately.
 *   - نظام وسائل وآليات تنفيذ بدائل العقوبات السالبة للحرية.pdf (no number in
 *     the filename): byte-different but content-identical (same page/chunk/
 *     article counts) to ...رقم 46 لسنة 2022.pdf, which is used instead.
 *   - قرار بتحديد الصحف الاوسع انتشاراً... and لائحة أجور أتعاب الكاتب العدل:
 *     no existing match at all — handled as new-source inserts separately.
 *
 * Same supersession pattern as tmp-supersede-batch.ts/batch2.ts: metadata
 * inherited from the existing row, old row flipped to is_current_version =
 * false only after the new one ingests successfully.
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

const FILES: { file: string; existingId: number }[] = [
  { file: "التعليمات_الناظمة_للبيع_بالمزاد_الالكتروني_رقم_1_لسنة_2022.pdf", existingId: 69 },
  { file: "تعليمات_أماكن_حجز_المركبات_رقم_1_لسنة_2021.pdf", existingId: 38 },
  { file: "تعليمات_المراقبة_الالكترونية_2025.pdf", existingId: 55 },
  { file: "تعليمات_امتحان_مزاولة_اعمال_الكاتب_العدل_المرخص_رقم_2_لسنة_2015.pdf", existingId: 56 },
  { file: "تعليمات_تنظيم_المساعدة_القانونية_المقدمة_من_وزارة_العدل_رقم_1_لسنة_2016.pdf", existingId: 46 },
  { file: "تعليمات_تنظيم_عمل_الكاتب_العدل_المرخص_رقم_1_لسنة_2015.pdf", existingId: 67 },
  { file: "تعليمات_شؤون_الخبرة_لسنة_2018.pdf", existingId: 54 },
  { file: "تعليمات_مهام_مديرية_العقوبات_المجتمعية_في_وزارة_العدل_لسنة_2018.pdf", existingId: 42 },
  { file: "نظام_اتالف_الاوراق_المستعملة_رقم_4_لسنة_1944.pdf", existingId: 45 },
  { file: "نظام_اتلاف_القضايا_والاوراق_القضائية_في_المحاكم_النظامية_وتعديلاته_رقم_44_لسنة_2005.pdf", existingId: 41 },
  { file: "نظام_استخدام_الوسائل_الالكترونية_في_معاملات_الكاتب_العدل_2026.pdf", existingId: 52 },
  { file: "نظام_استخدام_وسائل_التقنية_الحديثة_في_الاجراءات_الجزائية_رقم_96_لسنة_2018.pdf", existingId: 66 },
  { file: "نظام_استعمال_الوسائل_الالكترونية_في_الاجراءات_القضائية_المدنية_رقم_95_لسنة_2018.pdf", existingId: 40 },
  { file: "نظام_الانتقال_والسفر_وتعديلاته_رقم_56_لسنة_1981.pdf", existingId: 37 },
  { file: "نظام_التنظيم_الاداري_لوزارة_العدل_رقم_2_لسنة_2022.pdf", existingId: 65 },
  { file: "نظام_الخبرة_أمام_المحاكم_النظامية_لسنة_2018.pdf", existingId: 61 },
  { file: "نظام_الخدمة_القضائية_للقضاة_النظاميين_وتعديلاته_رقم_2_لسنة_2020.pdf", existingId: 59 },
  { file: "نظام_المركبات_المحجوزة_وتعديلاته_رقم_60_لسنة_2020.pdf", existingId: 39 },
  { file: "نظام_المساعدة_القانونية_رقم_119_لسنة_2018.pdf", existingId: 49 },
  { file: "نظام_المعهد_القضائي_الاردني_رقم_49_لسنة_2020.pdf", existingId: 50 },
  { file: "نظام_المكتب_الفني_لمحكمة_التمييز_وتعديلاته_رقم_7_لسنة_2010.pdf", existingId: 43 },
  { file: "نظام_تبليغ_الاوراق_القضائية_بواسطة_الشركات_رقم_39_لسنة_2001.pdf", existingId: 44 },
  { file: "نظام_ترخيص_الكاتب_العدل_وتعديلاته_رقم_22_لسنة_2015.pdf", existingId: 48 },
  { file: "نظام_خدمة_وكلاء_ادارة_قضايا_الدولة_لسنة_2010.pdf", existingId: 58 },
  { file: "نظام_رقم_(٤٦)_لسنة_٢٠٢٣_نظام_معدل_لنظام_دور_إيواء_المجنى_عليهم_والمتضررين_من_جرائم_الاتجار_بالبشر.pdf", existingId: 53 },
  { file: "نظام_صندوق_التكافل_الاجتماعي_لموظفي_وزارة_العدل_رقم_117_لسنة_2017.pdf", existingId: 47 },
  { file: "نظام_صندوق_مساعدة_ضحايا_الاتجار_بالبشر_رقم_6_لسنة_2023.pdf", existingId: 70 },
  { file: "نظام_عمل_دائرة_إشهار_الذمة_المالية_رقم_111_لسنة_2014.pdf", existingId: 63 },
  { file: "نظام_معدل_لنظام_التنظيم_اإلداري_لوزارة_العدل_رقم_59_لسنة_2023.pdf", existingId: 51 },
  { file: "نظام_معدل_لنظام_المساعدة_القانونية_رقم_53_لسنة_2022.pdf", existingId: 64 },
  { file: "نظام_وسائل_وآليات_تنفيذ_بدائل_العقوبات_السالبة_للحرية_رقم_46_لسنة_2022.pdf", existingId: 36 },
];

async function main() {
  const folder = join(process.cwd(), "الأنظمة");
  let ok = 0;
  let failed = 0;

  for (const b of FILES) {
    const old = await queryOne<ExistingSource>(
      `SELECT id, title, source_type, category, court, law_number, year, effective_date::text
         FROM legal_sources WHERE id = $1`,
      [b.existingId]
    );
    if (!old) {
      console.log(`PROGRESS ! existing source ${b.existingId} not found — skipping ${b.file}`);
      failed++;
      continue;
    }

    const filePath = join(folder, b.file);
    const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO legal_sources
         (title, source_type, category, court, year, law_number, effective_date, supersedes, file_path, file_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
      [old.title, old.source_type, old.category, old.court, old.year, old.law_number, old.effective_date, old.id, filePath, fileHash]
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
      console.log(`PROGRESS ok [${old.id}→${newId}] ${old.title.slice(0, 60)} — ${result.chunks} chunks, ${result.pages} pages, ${result.method}`);
    } catch (err) {
      failed++;
      console.log(`PROGRESS FAILED [${old.id}] ${old.title.slice(0, 60)} — ${(err as Error).message}`);
    }
  }

  console.log(`PROGRESS DONE ${ok} superseded, ${failed} failed, of ${FILES.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log(`PROGRESS FATAL ${err.message}`);
  process.exit(1);
});
