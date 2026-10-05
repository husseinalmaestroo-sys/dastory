/**
 * Builds a LOCAL, production-shaped rehearsal database for the Phase 2.4 live
 * sequence (deploy/live-corpus-sequence.sh): the ORIGINAL schema (commit
 * 0dc62ff, tests/fixtures/schema-0dc62ff.sql — production may still be on it)
 * and the sources this repository records for production, at their recorded
 * ids and titles: the corrupted Civil Code (id 2), the old corrupted Penal Code
 * (id 3) and its secondary re-ingest (id 170), the Legislation Bureau
 * re-ingests (159–161), the hand-entered Labour article 138, the damaged Real
 * Property title, memoranda filed as instructions, an interpretation decision
 * filed as a principle, a fee schedule filed as a template, an executive
 * decision filed as a court decision, a Bar Association republication, a
 * Constitution chapter file and a tatweel title.
 *
 * THE TEXTS ARE INVENTED PLACEHOLDERS — never law, never quoted, never
 * presented as any law's text. They exist only so the integrity check, the
 * manifest and retrieval have something to judge. Refuses any non-local
 * database.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/ailegal_rehearsal \
 *     EMBEDDING_PROVIDER=test npx tsx --tsconfig scripts/tsconfig.verify.json scripts/rehearsal-build.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describeTarget, targetLine } from "../src/lib/db-target";
import { foldForSearch } from "../src/lib/ingest/clean";
import { getEmbeddingProvider } from "../src/lib/ai";

const url = process.env.DATABASE_URL ?? "";
const target = describeTarget(url);
if (target.environment !== "local") {
  console.error(`Refusing: the rehearsal database must be local (${targetLine(target)}).`);
  process.exit(2);
}

const garble = (t: string) =>
  [...t].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x0621 && c <= 0x064a ? String.fromCharCode(0x0621 + (((c - 0x0621) * 5 + 11) % 42)) : ch;
  }).join("");

/** An invented, clearly non-legal placeholder article — enough Arabic for the checks to judge. */
const placeholder = (subject: string, n: number) =>
  `المادة ${n}: نص تجريبي للتمرين عن ${subject}، وهو ليس نصاً قانونياً ولا يُقتبس. يلتزم الطرف المعني في هذا المثال بأن يقدّم طلبه إلى الجهة المختصة خلال المدة المحددة، وعلى الجهة أن تبتّ فيه وفق الإجراءات المقررة، ويجوز الاعتراض على قرارها أمام المرجع المختص. `.repeat(2);

/** An invented decision-like placeholder in varied prose (a single repeated sentence is not how any real text reads). */
const decisionPlaceholder = (subject: string) =>
  `هذا نص تجريبي للتمرين عن ${subject}، وليس قراراً حقيقياً ولا يُقتبس. ` +
  "تبيّن من الأوراق في هذا المثال أن الطلب قُدّم إلى الجهة المختصة بعد انقضاء المدة. " +
  "ولا يجوز الاحتجاج بإجراء لم يُبلَّغ إلى صاحب العلاقة، وهو ما يكون عليه الحكم في مثل هذه الحالات. " +
  "وعليه تقرر رد الاعتراض، مع حفظ حق الطرف الآخر في المطالبة أمام المرجع المختص عند توافر الشروط. " +
  "ويُعمل بهذا القرار التجريبي من تاريخ صدوره، ولا أثر له خارج هذا التمرين. ";

type Spec = {
  id: number;
  title: string;
  source_type: string;
  subject: string;
  articles: number[];
  garbled?: boolean;
  current?: boolean;
  file_path?: string;
  note?: string;
  law_number?: string | null;
  year?: number | null;
  court?: string | null;
};

const SOURCES: Spec[] = [
  { id: 2, title: "القانون المدني رقم 43 لسنة 1976", source_type: "law", subject: "العقود والالتزامات", articles: [1, 2, 3, 4, 5, 6, 7, 8], garbled: true, law_number: "43", year: 1976 },
  { id: 3, title: "قانون العقوبات وتعديلاته رقم 16 لسنة 1960", source_type: "law", subject: "الجرائم والعقوبات", articles: [1, 2, 3, 4, 5, 6], garbled: true, current: false, law_number: "16", year: 1960 },
  { id: 159, title: "قانون التجارة الأردني رقم 12 لسنة 1966", source_type: "law", subject: "الأعمال التجارية والشيك", articles: [1, 2, 3, 4, 5, 6, 7], law_number: "12", year: 1966, file_path: "downloads/lob/commercial.txt" },
  { id: 160, title: "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته", source_type: "law", subject: "عقد العمل والأجور", articles: [1, 2, 3, 4, 5, 6, 7, 8, 9], law_number: "8", year: 1996, file_path: "downloads/lob/labour.txt" },
  { id: 161, title: "قانون الشركات الأردني رقم 22 لسنة 1997 وتعديلاته", source_type: "law", subject: "تأسيس الشركات", articles: [1, 2, 3, 4, 5, 6], law_number: "22", year: 1997, file_path: "downloads/lob/companies.txt" },
  { id: 170, title: "قانون العقوبات الأردني مع كامل التعديلات", source_type: "law", subject: "الجرائم والعقوبات", articles: [1, 2, 3, 4, 5, 6, 7, 8] },
  {
    id: 200,
    title: "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته",
    source_type: "law",
    subject: "تقادم دعاوى العمل",
    articles: [138],
    note: "نص المادة أُدخل يدوياً … وتم التحقق منه عبر مصدرين ثانويين مستقلين (iclc-law.com، jordan-lawyer.com) قبل الإدخال.",
  },
  { id: 201, title: "قانون الملكية العقارية لسنة أحكام عامة", source_type: "law", subject: "تسجيل العقارات", articles: [1, 2, 3, 4, 5, 6] },
  { id: 202, title: "مذكرة تفاهم حول الربط الإلكتروني بين وزارة العدل ونقابة المحامين", source_type: "instruction", subject: "الربط الإلكتروني وتبادل البيانات", articles: [1, 2, 3] },
  { id: 203, title: "مذكرة تفاهم بين وزارة العدل وشركة قسطاس لتقنية المعلومات", source_type: "instruction", subject: "أنظمة المعلومات", articles: [1, 2, 3] },
  { id: 204, title: "قرار الديوان الخاص بتفسير القوانين — 30", source_type: "principle", subject: "تفسير نص", articles: [] },
  { id: 205, title: "لائحة أجور أتعاب الكاتب العدل المرخص لسنة 2015", source_type: "template", subject: "أجور الكاتب العدل", articles: [1, 2, 3, 4] },
  { id: 206, title: "قرار بتحديد الصحف الاوسع انتشارا لنشر الاعلانات والتبليغات القضائية لسنة 2021", source_type: "court_decision", subject: "النشر في الصحف", articles: [] },
  { id: 207, title: "camscanner1", source_type: "court_decision", subject: "حكم في نزاع", articles: [], file_path: "downloads/jba-decisions/camscanner1.pdf", court: "محكمة الاستئناف" },
  { id: 208, title: "الدستور الأردني — الفصل05", source_type: "law", subject: "السلطة التنفيذية", articles: [40, 41, 42, 43, 44, 45, 46] },
  { id: 209, title: "قانــــون العفو العام رقـم 5 لسنـــــة 2024", source_type: "law", subject: "العفو العام", articles: [1, 2, 3, 4] },
  { id: 210, title: "قانون اصول المحاكمات المدنية وتعديلاته رقم 24 لسنة 1988", source_type: "law", subject: "إجراءات التقاضي", articles: [1, 2, 3, 4, 5], law_number: "24", year: 1988, file_path: "downloads/moj-laws/قانون_اصول_المحاكمات_المدنية_وتعديلاته_رقم_24_لسنة_1988.pdf" },
];

async function main() {
  const dbName = new URL(url).pathname.slice(1);
  const admin = new Pool({ connectionString: url.replace(/\/[^/?]+(\?|$)/, "/postgres$1"), max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const pool = new Pool({ connectionString: url, max: 2 });
  await pool.query(readFileSync(resolve(__dirname, "../tests/fixtures/schema-0dc62ff.sql"), "utf8"));
  const provider = getEmbeddingProvider();
  for (const s of SOURCES) {
    const texts = (s.articles.length ? s.articles : [0]).map((n) => {
      const body = n ? placeholder(s.subject, n) : decisionPlaceholder(s.subject);
      return s.garbled ? garble(body).repeat(2) : body;
    });
    await pool.query(
      `INSERT INTO legal_sources (id, title, source_type, court, year, file_path, status, chunk_count, note, law_number, is_current_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $8, $9, $10)`,
      [s.id, s.title, s.source_type, s.court ?? null, s.year ?? null, s.file_path ?? null, texts.length, s.note ?? null, s.law_number ?? null, s.current ?? true]
    );
    const { embeddings } = await provider.embed(texts, "document");
    for (let i = 0; i < texts.length; i++) {
      await pool.query(
        `INSERT INTO legal_documents (source_id, chunk_index, chunk_text, folded_text, stemmed_text, embedding, article_number, law_name, law_number, court, year)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10)`,
        [s.id, i, texts[i], foldForSearch(texts[i]), `[${embeddings[i].join(",")}]`, s.articles[i] ? String(s.articles[i]) : null, s.title, s.law_number ?? null, s.court ?? null, s.year ?? null]
      );
    }
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('legal_sources', 'id'), 1000)`);
  const n = await pool.query(`SELECT count(*)::int AS s, (SELECT count(*)::int FROM legal_documents) AS d FROM legal_sources`);
  console.log(`Rehearsal database ${targetLine(target)}: ${n.rows[0].s} sources, ${n.rows[0].d} chunks, original schema 0dc62ff. Texts are placeholders.`);
  await pool.end();
}

main().catch((err) => {
  console.error("rehearsal build failed:", (err as Error).message);
  process.exit(1);
});
