import "dotenv/config";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { expandWithOntology } from "../src/lib/search/legal-ontology";

async function main() {
  const q = normalizeQuery("ما هي المحكمة المختصة بنظر الدعوى الحقوقية؟");
  const rules = analyzeQueryRules(q);
  console.log("rules.legalArea:", rules.legalArea, " queryType:", rules.queryType);
  console.log("ontology match (should be empty — none of this session's new entries mention court jurisdiction):", JSON.stringify(expandWithOntology(q)));

  const expansion = await expandQuery(q, rules, { allowLLM: false });
  console.log("expansion.addedTerms (should be []):", JSON.stringify(expansion.addedTerms));

  const withArea = await hybridSearch(q, {}, 8, { searchText: expansion.searchText, orGroup: expansion.orGroup, queryType: rules.queryType, legalArea: rules.legalArea });
  const withoutArea = await hybridSearch(q, {}, 8, { searchText: expansion.searchText, orGroup: expansion.orGroup, queryType: rules.queryType, legalArea: null });

  const target = (c: { law_name: string | null; source_title: string }) => (c.law_name ?? c.source_title).includes("اصول المحاكمات المدنية");

  console.log("\nWITH legalArea (current 'after' behavior):");
  withArea.chunks.forEach((c, i) => console.log(`  #${i + 1} ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"} score=${c.score.toFixed(4)}${target(c) ? "  <== EXPECTED SOURCE" : ""}`));

  console.log("\nWITHOUT legalArea (topic-boost disabled for this call):");
  withoutArea.chunks.forEach((c, i) => console.log(`  #${i + 1} ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"} score=${c.score.toFixed(4)}${target(c) ? "  <== EXPECTED SOURCE" : ""}`));

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
