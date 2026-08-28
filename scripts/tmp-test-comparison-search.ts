import "dotenv/config";
import { detectComparison } from "../src/lib/search/comparison";
import { comparisonSearch } from "../src/lib/search/comparison-search";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { normalizeQuery } from "../src/lib/search/normalize";

const QUESTIONS = [
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟",
  "ما الفرق بين العقد الباطل والعقد القابل للإبطال؟",
  "ما الفرق بين الفصل التعسفي والفصل المشروع؟",
  "ما الفرق بين المسؤولية العقدية والمسؤولية التقصيرية؟",
  "ما الفرق بين القرض والوديعة؟",
  "ما الفرق بين الشرط الفاسخ والشرط الواقف؟",
  "ما الفرق بين البطلان والفسخ في العقود؟",
];

async function main() {
  for (const question of QUESTIONS) {
    const q = normalizeQuery(question);
    const split = detectComparison(q);
    console.log("\n" + "=".repeat(90));
    console.log("Q:", q);
    if (!split) {
      console.log("  (no comparison detected — would fall back to normal single-query path)");
      continue;
    }
    console.log(`  split: A="${split.sideA}"  B="${split.sideB}"`);
    const rules = analyzeQueryRules(q);
    const result = await comparisonSearch(q, split.sideA, split.sideB, {}, 8, {
      queryType: rules.queryType,
      legalArea: rules.legalArea,
    });
    console.log(
      `  merged n=${result.chunks.length} (A:${result.chunksA.length} B:${result.chunksB.length})  confidence=${result.confidence.label}(${result.confidence.score})  [A=${result.confidenceA.label}(${result.confidenceA.score}) B=${result.confidenceB.label}(${result.confidenceB.score})]`
    );
    console.log(`  --- side A top hits ---`);
    for (const c of result.chunksA.slice(0, 5)) {
      console.log(`    #${c.id} [${c.matched_by}] ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"}  ${c.chunk_text.replace(/\s+/g, " ").slice(0, 90)}...`);
    }
    console.log(`  --- side B top hits ---`);
    for (const c of result.chunksB.slice(0, 5)) {
      console.log(`    #${c.id} [${c.matched_by}] ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"}  ${c.chunk_text.replace(/\s+/g, " ").slice(0, 90)}...`);
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
