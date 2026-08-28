import "dotenv/config";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { expandWithOntology } from "../src/lib/search/legal-ontology";

async function main() {
  const q = normalizeQuery("ما هي أركان جريمة الاحتيال؟");
  const rules = analyzeQueryRules(q);
  console.log("rules:", JSON.stringify(rules, null, 2));
  console.log("ontology:", JSON.stringify(expandWithOntology(q), null, 2));

  const expansion = await expandQuery(q, rules);
  console.log("expansion (LLM allowed):", JSON.stringify({ addedTerms: expansion.addedTerms, source: expansion.source }, null, 2));

  const { chunks, confidence } = await hybridSearch(q, {}, 8, {
    searchText: expansion.searchText,
    orGroup: expansion.orGroup,
    queryType: rules.queryType,
    legalArea: rules.legalArea,
  });
  console.log(`n=${chunks.length} confidence=${confidence.label}(${confidence.score})`);
  for (const c of chunks) {
    console.log(`  #${c.id} [${c.matched_by}] vec=${c.vector_score?.toFixed(3)} kw=${c.keyword_score?.toFixed(3)} ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"}`);
    console.log(`      ${c.chunk_text.replace(/\s+/g, " ").slice(0, 150)}`);
  }

  // Wide probe: does the corpus even have a dedicated "أركان الاحتيال" article?
  const { getEmbeddingProvider } = await import("../src/lib/ai");
  const { query: dbQuery, toVector } = await import("../src/lib/db");
  const provider = getEmbeddingProvider();
  const emb = await provider.embed(["الاحتيال الاستيلاء على مال الغير بطرق احتيالية استعمال طرق احتيالية الحمل على التسليم"], "query");
  const vec = toVector(emb.embeddings[0]);
  const rows = await dbQuery<{ id: number; law_name: string | null; article_number: string | null; score: number; chunk_text: string }>(
    `SELECT id, law_name, article_number, (1 - (embedding <=> $1::vector))::real AS score, chunk_text
       FROM legal_documents WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 8`,
    [vec]
  );
  console.log("\nwide probe (dedicated fraud vocabulary, no gate):");
  for (const r of rows) {
    console.log(`  #${r.id} score=${r.score.toFixed(3)} ${r.law_name ?? ""} م.${r.article_number ?? "?"}  ${r.chunk_text.replace(/\s+/g, " ").slice(0, 150)}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
