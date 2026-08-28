import "dotenv/config";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";

async function main() {
  const q = normalizeQuery("ما هي إجراءات الادعاء بالحق الشخصي أمام المحكمة الجزائية؟");
  const rules = analyzeQueryRules(q);
  console.log("rules.legalArea (now, without المحكم trigger):", rules.legalArea, " queryType:", rules.queryType);

  const expansion = await expandQuery(q, rules, { allowLLM: false });
  const withArea = await hybridSearch(q, {}, 8, { searchText: expansion.searchText, orGroup: expansion.orGroup, queryType: rules.queryType, legalArea: rules.legalArea });
  const forcedTahkim = await hybridSearch(q, {}, 8, { searchText: expansion.searchText, orGroup: expansion.orGroup, queryType: rules.queryType, legalArea: "تحكيم" });

  const target = (c: { law_name: string | null; source_title: string }) => (c.law_name ?? c.source_title).includes("اصول المحاكمات الجزائية");

  console.log("\nCURRENT (legalArea correctly resolved, no تحكيم false-boost):");
  withArea.chunks.forEach((c, i) => console.log(`  #${i + 1} ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"} score=${c.score.toFixed(4)}${target(c) ? "  <== EXPECTED SOURCE" : ""}`));

  console.log("\nOLD BUGGY BEHAVIOR (legalArea forced to تحكيم, simulating the removed trigger):");
  forcedTahkim.chunks.forEach((c, i) => console.log(`  #${i + 1} ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"} score=${c.score.toFixed(4)}${target(c) ? "  <== EXPECTED SOURCE" : ""}`));

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
