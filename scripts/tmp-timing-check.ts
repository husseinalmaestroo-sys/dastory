import "dotenv/config";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { detectComparison } from "../src/lib/search/comparison";
import { comparisonSearch } from "../src/lib/search/comparison-search";
import { normalizeQuery } from "../src/lib/search/normalize";
import { expandQuery } from "../src/lib/search/query-expansion";

const QUESTIONS = [
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟",
  "ما هي شروط بطلان حكم التحكيم؟",
];

async function main() {
  // Warm the embedding cache first (a cold OpenAI embedding call is not what
  // "retrieval latency" should mean here — route.ts's own cache exists
  // exactly to avoid paying it twice for a repeated question).
  for (const q of QUESTIONS) {
    const n = normalizeQuery(q);
    const rules = analyzeQueryRules(n);
    const cmp = detectComparison(n);
    if (cmp) await comparisonSearch(n, cmp.sideA, cmp.sideB, {}, 8, { queryType: rules.queryType, legalArea: rules.legalArea });
    else {
      const exp = await expandQuery(n, rules, { allowLLM: false });
      await hybridSearch(n, {}, 8, { searchText: exp.searchText, orGroup: exp.orGroup, queryType: rules.queryType, legalArea: rules.legalArea });
    }
  }

  console.log("warm timing (cached embeddings, matches a repeated/common question):");
  for (const q of QUESTIONS) {
    const n = normalizeQuery(q);
    const rules = analyzeQueryRules(n);
    const cmp = detectComparison(n);
    const t0 = Date.now();
    if (cmp) await comparisonSearch(n, cmp.sideA, cmp.sideB, {}, 8, { queryType: rules.queryType, legalArea: rules.legalArea });
    else {
      const exp = await expandQuery(n, rules, { allowLLM: false });
      await hybridSearch(n, {}, 8, { searchText: exp.searchText, orGroup: exp.orGroup, queryType: rules.queryType, legalArea: rules.legalArea });
    }
    console.log(`  ${Date.now() - t0}ms  [${cmp ? "comparison (2x retrieval)" : "single query"}]  ${q.slice(0, 50)}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
