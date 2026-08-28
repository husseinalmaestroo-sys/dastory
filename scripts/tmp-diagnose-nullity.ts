/**
 * Diagnostic repro for the البطلان المطلق/البطلان النسبي false-refusal report.
 * Runs the exact pre-generation pipeline (rules → expansion → hybridSearch)
 * and dumps every intermediate value so the failure point can be identified
 * from real data instead of guesswork. Read-only — no writes, no generation.
 */
import "dotenv/config";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { expandWithOntology } from "../src/lib/search/legal-ontology";
import { resolveThresholds } from "../src/lib/search/confidence";

const QUESTIONS = [
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟",
  "ما الفرق بين العقد الباطل والعقد القابل للإبطال؟",
];

async function runOne(question: string) {
  console.log("\n" + "=".repeat(90));
  console.log("Q:", question);
  const normalized = normalizeQuery(question);
  const rules = analyzeQueryRules(normalized);
  console.log("\n-- rules (analyzeQueryRules) --");
  console.log(JSON.stringify(rules, null, 2));

  const ont = expandWithOntology(normalized);
  console.log("\n-- ontology matches (expandWithOntology) --");
  console.log(JSON.stringify(ont, null, 2));

  const expansion = await expandQuery(normalized, rules, { allowLLM: false });
  console.log("\n-- expansion (LLM disabled, ontology-only — matches real first-pass for doctrinal_question) --");
  console.log(JSON.stringify({ addedTerms: expansion.addedTerms, source: expansion.source, orGroup: expansion.orGroup }, null, 2));

  const thresholds = resolveThresholds(rules.queryType, { reranked: false, expanded: !!expansion.orGroup });
  console.log("\n-- gate thresholds for this queryType --");
  console.log(JSON.stringify(thresholds, null, 2));

  const result = await hybridSearch(normalized, {}, 8, {
    searchText: expansion.searchText,
    orGroup: expansion.orGroup,
    queryType: rules.queryType,
    legalArea: rules.legalArea,
  });

  console.log(`\n-- hybridSearch: ${result.chunks.length} chunk(s), confidence=${result.confidence.label} (${result.confidence.score}) --`);
  console.log("reason:", result.confidence.reason);
  for (const c of result.chunks) {
    console.log(
      `  #${c.id} [${c.matched_by}] score=${c.score.toFixed(4)} vec=${c.vector_score?.toFixed(3)} kw=${c.keyword_score?.toFixed(3)} stem=${c.stem_score?.toFixed(3)}` +
        `  ${c.law_name ?? c.source_title} م.${c.article_number ?? "?"}`
    );
    console.log(`      text: ${c.chunk_text.replace(/\s+/g, " ").slice(0, 140)}...`);
  }

  // Also run a WIDE, unfiltered vector-only probe against the corpus so we can
  // see whether "relative nullity" material exists in the DB at all but is
  // simply not clearing the gate/expansion, vs. genuinely absent.
  const { query, toVector } = await import("../src/lib/db");
  const { getEmbeddingProvider } = await import("../src/lib/ai");
  const provider = getEmbeddingProvider();
  const probeTerms = ["عيوب الرضا الغلط التغرير الإكراه الاستغلال إبطال العقد نقص الأهلية العقد الموقوف", "البطلان النسبي قابلية الإبطال"];
  for (const term of probeTerms) {
    const emb = await provider.embed([term], "query");
    const vec = toVector(emb.embeddings[0]);
    const rows = await query<{ id: number; law_name: string | null; article_number: string | null; score: number; chunk_text: string }>(
      `SELECT d.id, d.law_name, d.article_number, (1 - (d.embedding <=> $1::vector))::real AS score, d.chunk_text
         FROM legal_documents d WHERE d.embedding IS NOT NULL ORDER BY d.embedding <=> $1::vector LIMIT 6`,
      [vec]
    );
    console.log(`\n-- wide vector probe for "${term}" (no gate, no filters) --`);
    for (const r of rows) {
      console.log(`  #${r.id} score=${r.score.toFixed(3)} ${r.law_name ?? ""} م.${r.article_number ?? "?"}  ${r.chunk_text.replace(/\s+/g, " ").slice(0, 120)}...`);
    }
  }
}

async function main() {
  for (const q of QUESTIONS) await runOne(q);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
