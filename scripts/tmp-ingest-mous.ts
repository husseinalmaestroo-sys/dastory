/**
 * اتفاقيات الوزارة/ — 5 of the 6 supplied MOU PDFs (the 6th, a waste-paper
 * recycling sale contract, was excluded per the user's explicit choice —
 * genuinely out of scope for a legal-research corpus).
 *
 * All 5 are real Ministry-of-Justice inter-agency memoranda (Bar Association
 * x2, Public Security Directorate, Customs Department, and the "Qistas"
 * legal-database vendor) with no existing DB match at all — brand new
 * source category for this corpus. Filenames on disk are meaningless UUIDs
 * (no title info), so each was read directly with Claude's vision-capable
 * Read tool and hand-transcribed to a clean .txt, same technique already
 * proven today for قانون التنفيذ/منع الاتجار بالبشر/الكاتب العدل.
 *
 * source_type='instruction' is the closest fit in the schema's fixed enum
 * (law/regulation/instruction/court_decision/principle/template) — none of
 * these describe a bilateral administrative MOU exactly, but 'instruction'
 * (procedural/administrative content, not primary legislation) is the
 * least-wrong bucket among what actually exists.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { queryOne } from "../src/lib/db";
import { ingestSource } from "../src/lib/ingest/pipeline";

const SCRATCH = "C:\\Users\\husse\\AppData\\Local\\Temp\\claude\\C--Users-husse-Desktop-Ai-legal\\77da35d3-6e3f-415c-a8a5-4bc8b071fe8f\\scratchpad";

const MOUS: { file: string; title: string; year: number | null }[] = [
  { file: "mou-bar-electronic-link-2015.txt", title: "مذكرة تفاهم حول الربط الإلكتروني بين وزارة العدل ونقابة المحامين", year: 2015 },
  { file: "mou-bar-legal-aid-2015.txt", title: "مذكرة تفاهم في مجال المساعدة القانونية بين وزارة العدل ونقابة المحامين", year: 2015 },
  { file: "mou-qistas-2014.txt", title: "مذكرة تفاهم بين وزارة العدل وشركة قسطاس لتقنية المعلومات", year: 2014 },
  { file: "mou-public-security-vehicles.txt", title: "مذكرة تفاهم بين وزارة العدل ومديرية الأمن العام حول الربط الالكتروني لإدارة ترخيص السواقين والمركبات", year: null },
  { file: "mou-customs-2013.txt", title: "مذكرة تفاهم في مجال تبادل المعلومات بين وزارة العدل ودائرة الجمارك الأردنية", year: 2013 },
];

async function main() {
  for (const m of MOUS) {
    const filePath = `${SCRATCH}\\${m.file}`;
    const fileHash = createHash("sha256").update(await readFile(filePath)).digest("hex");

    console.log(`\n${"=".repeat(90)}`);
    console.log(m.title);

    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO legal_sources (title, source_type, year, file_path, file_hash, status)
       VALUES ($1,'instruction',$2,$3,$4,'pending') RETURNING id`,
      [m.title, m.year, filePath, fileHash]
    );
    const newId = inserted!.id;

    const result = await ingestSource({
      sourceId: newId, filePath, title: m.title, sourceType: "instruction", year: m.year,
    });
    console.log(`  ok — new source [${newId}]: ${result.chunks} chunks, ${result.pages} pages, ${result.method}`);
  }

  console.log(`\n${"=".repeat(90)}\n  done\n${"=".repeat(90)}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
