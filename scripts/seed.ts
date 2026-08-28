/**
 * Seeds a few short legal texts straight into the index — no PDFs needed.
 *
 * Purpose is to make the retrieval chain testable end-to-end on a fresh box:
 * it embeds through the real provider and writes real rows, so if search works
 * against this, the only untested link left is PDF extraction.
 *
 *   npm run db:seed
 *
 * The texts below are short paraphrases written for testing. They are NOT an
 * authoritative statement of Jordanian law — replace them with real uploads
 * via the admin dashboard before anyone relies on an answer.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { chunkLegalText } from "../src/lib/ingest/chunk";
import { cleanText, foldForSearch } from "../src/lib/ingest/clean";
import { getEmbeddingProvider } from "../src/lib/ai";

const SAMPLES = [
  {
    title: "[عيّنة اختبار] أحكام عقد المقاولة",
    source_type: "law",
    category: "مدنية",
    text: `
قانون تجريبي في المقاولة

المادة 1 : المقاولة عقد يتعهد بمقتضاه أحد الطرفين أن يصنع شيئاً أو يؤدي عملاً لقاء بدل يتعهد به الطرف الآخر.

المادة 2 : إذا كان المقاول قد تعهد بتقديم مادة العمل كلها أو بعضها كان مسؤولاً عن جودتها وضامناً لها لرب العمل.

المادة 3 : يجوز لرب العمل أن يتحلل من العقد ويوقف التنفيذ في أي وقت قبل إتمامه على أن يعوض المقاول عن جميع ما أنفقه من مصروفات وما أنجزه من أعمال وما كان يستطيع كسبه لو أتم العمل.

المادة 4 : ينفسخ عقد المقاولة إذا وقع حادث لا يمكن دفعه يحول دون تنفيذ العقد أو دون إتمام تنفيذه.

المادة 5 : تسقط دعوى الضمان في عقد المقاولة بانقضاء ثلاث سنوات من وقت حصول التهدم أو انكشاف العيب.
`,
  },
  {
    title: "[عيّنة اختبار] التقادم في الدعاوى العمالية",
    source_type: "law",
    category: "عمالية",
    text: `
قانون تجريبي في العمل

المادة 10 : لا تسمع دعوى المطالبة بأي حق من الحقوق المنصوص عليها في هذا القانون بعد مرور سنتين على تاريخ استحقاق الحق.

المادة 11 : تعفى الدعاوى العمالية من الرسوم القضائية في جميع مراحل التقاضي.

المادة 12 : يستحق العامل المفصول تعسفياً تعويضاً لا يقل عن أجر شهرين ولا يزيد على أجر ستة أشهر.
`,
  },
  {
    title: "[عيّنة اختبار] قرار تمييز حقوق رقم 1234/2020",
    source_type: "court_decision",
    category: "حقوقية",
    court: "محكمة التمييز",
    year: 2020,
    text: `
محكمة التمييز بصفتها الحقوقية
القرار رقم 1234/2020
لسنة 2020

المبدأ القانوني : لا تعويض بلا ضرر محقق وثابت، ويقع عبء إثبات الضرر وعلاقة السببية على عاتق المدعي.

الوقائع :
أقام المدعي دعواه يطالب فيها بالتعويض عن الأضرار المادية والأدبية التي لحقت به نتيجة إخلال المدعى عليه بالتزاماته التعاقدية.

الأسباب :
وحيث أن المستقر عليه في اجتهاد هذه المحكمة أن التعويض يستلزم توافر ثلاثة أركان هي الخطأ والضرر وعلاقة السببية بينهما، وأن الضرر المحتمل لا يصلح أساساً للتعويض ما لم يكن محقق الوقوع.

لهذه الأسباب :
تقرر المحكمة رد الطعن التمييزي موضوعاً وتأييد القرار المميز.
`,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set — seeding calls the embedding API.");

  const pool = new Pool(poolConfig(process.env.DATABASE_URL));
  const provider = getEmbeddingProvider();

  for (const s of SAMPLES) {
    const text = cleanText(s.text);
    const chunks = chunkLegalText(text, { sourceType: s.source_type });

    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO legal_sources (title, source_type, category, court, year, status, chunk_count)
       VALUES ($1,$2,$3,$4,$5,'ready',$6) RETURNING id`,
      [s.title, s.source_type, s.category ?? null, (s as any).court ?? null, (s as any).year ?? null, chunks.length]
    );
    const sourceId = rows[0].id;

    const { embeddings } = await provider.embed(chunks.map((c) => c.text), "document");

    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        `INSERT INTO legal_documents
           (source_id, chunk_index, chunk_text, folded_text, extracted_text, embedding,
            article_number, law_name, court, year, category, keywords, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          sourceId,
          i,
          chunks[i].text,
          foldForSearch(chunks[i].text),
          i === 0 ? text : null,
          `[${embeddings[i].join(",")}]`,
          chunks[i].articleNumber,
          s.source_type === "court_decision" ? null : s.title,
          (s as any).court ?? null,
          (s as any).year ?? null,
          s.category ?? null,
          chunks[i].keywords,
          JSON.stringify({ source_title: s.title, source_type: s.source_type, seeded: true }),
        ]
      );
    }

    console.log(`  seeded "${s.title}" — ${chunks.length} chunks`);
  }

  await pool.end();
  console.log("\nDone. Try asking: \"ما شروط فسخ عقد المقاولة؟\" or \"ما هي المادة 5؟\"");
  console.log('Sample rows are titled "[عيّنة اختبار]" — delete them from /admin before going live.');
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
