/**
 * One-off: add the real Article 138 (limitation periods for labor claims) of
 * the Jordanian Labor Law No. 8/1996 to the knowledge base.
 *
 * Text cross-checked against two independent secondary sources (iclc-law.com,
 * jordan-lawyer.com) since the official Gazette-sourced PDF (Amman Chamber of
 * Commerce mirror) extracts as mojibake — same known issue as other Jordanian
 * Gazette PDFs. Run once, then delete this script.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { chunkLegalText } from "../src/lib/ingest/chunk";
import { cleanText, foldForSearch } from "../src/lib/ingest/clean";
import { getEmbeddingProvider } from "../src/lib/ai";

const TITLE = "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته";
const CATEGORY = "عمالية";

const TEXT = `
المادة 138 :

أ - لا تسمع أي دعوى بشأن أي مخالفة ارتكبت خلافاً لأحكام هذا القانون أو أي نظام أو تعليمات صادرة بمقتضاه ما لم ترفع الدعوى خلال شهر واحد من التاريخ الذي ارتكبت فيه.

ب - لا تسمع أي دعوى للمطالبة بأي حقوق يرتبها هذا القانون بما في ذلك أجور ساعات العمل الإضافية مهما كان مصدرها أو منشؤها بعد مرور سنتين على نشوء سبب المطالبة بتلك الحقوق والأجور.
`;

const NOTE =
  "نص المادة أُدخل يدوياً بعد تعذّر استخراج نص مقروء آلياً من ملف الجريدة الرسمية (مشكلة ترميز خط معروفة)، وتم التحقق منه عبر مصدرين ثانويين مستقلين (iclc-law.com، jordan-lawyer.com) قبل الإدخال. يُستحسن استبداله بنسخة ممسوحة ضوئياً من الجريدة الرسمية عند توفرها.";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set — ingest calls the embedding API.");

  const pool = new Pool(poolConfig(process.env.DATABASE_URL));
  const provider = getEmbeddingProvider();

  const text = cleanText(TEXT);
  const chunks = chunkLegalText(text, { sourceType: "law" });

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO legal_sources (title, source_type, category, status, chunk_count, note)
     VALUES ($1,'law',$2,'ready',$3,$4) RETURNING id`,
    [TITLE, CATEGORY, chunks.length, NOTE]
  );
  const sourceId = rows[0].id;

  const { embeddings } = await provider.embed(chunks.map((c) => c.text), "document");

  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      `INSERT INTO legal_documents
         (source_id, chunk_index, chunk_text, folded_text, extracted_text, embedding,
          article_number, law_name, category, keywords, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        sourceId,
        i,
        chunks[i].text,
        foldForSearch(chunks[i].text),
        i === 0 ? text : null,
        `[${embeddings[i].join(",")}]`,
        chunks[i].articleNumber,
        TITLE,
        CATEGORY,
        chunks[i].keywords,
        JSON.stringify({ source_title: TITLE, source_type: "law", manualEntry: true }),
      ]
    );
  }

  console.log(`Inserted "${TITLE}" (source id ${sourceId}) — ${chunks.length} chunk(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
