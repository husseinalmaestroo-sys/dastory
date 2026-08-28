/**
 * BEFORE/AFTER snapshot for the comparison-question class described in the
 * false-refusal report (البطلان المطلق/النسبي and siblings). Run with no args
 * before making pipeline changes, then again after, to see the delta on the
 * same fixed question set. Retrieval-only (no generation) — cheap, no OpenAI
 * chat spend beyond embeddings.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/tmp-before-after-comparisons.ts [--label=before|after]
 */
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";

const QUESTIONS = [
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟",
  "ما الفرق بين العقد الباطل والعقد القابل للإبطال؟",
  "ما الفرق بين الفصل التعسفي والفصل المشروع؟",
  "ما الفرق بين المسؤولية العقدية والمسؤولية التقصيرية؟",
  "ما الفرق بين الجريمة المدنية والجريمة الجزائية؟",
  "ما الفرق بين القرض والوديعة؟",
  "ما الفرق بين الشرط الفاسخ والشرط الواقف؟",
  "ما هي شروط بطلان حكم التحكيم؟",
  "ما هي أسباب الإباحة وموانع المسؤولية؟",
  "ما الفرق بين البطلان والفسخ في العقود؟",
];

// Rough on-topic law/article expectations, hand-checked against the corpus —
// used only to report a crude "did the OTHER side show up at all" signal, not
// as a strict benchmark oracle.
const EXPECT: Record<string, RegExp> = {
  "ما الفرق بين البطلان المطلق والبطلان النسبي في القانون المدني الأردني؟ وما أثر كل منهما على العقد؟":
    /موقوف|خيار العيب|غلط|تغرير|اكراه|إكراه|استغلال/,
  "ما الفرق بين العقد الباطل والعقد القابل للإبطال؟": /موقوف|خيار العيب|غلط|تغرير|اكراه|إكراه|استغلال/,
  "ما الفرق بين الفصل التعسفي والفصل المشروع؟": /فصل|انهاء|إنهاء/,
  "ما الفرق بين المسؤولية العقدية والمسؤولية التقصيرية؟": /ضرر|فعل ضار|تعويض/,
  "ما الفرق بين الجريمة المدنية والجريمة الجزائية؟": /جريمة|جناية|جنحة|عقوبة/,
  "ما الفرق بين القرض والوديعة؟": /وديعة|ايداع|إيداع/,
  "ما الفرق بين الشرط الفاسخ والشرط الواقف؟": /شرط فاسخ|شرط واقف|معلق/,
  "ما هي شروط بطلان حكم التحكيم؟": /تحكيم/,
  "ما هي أسباب الإباحة وموانع المسؤولية؟": /اباحه|إباحة|مسؤوليه|مسؤولية/,
  "ما الفرق بين البطلان والفسخ في العقود؟": /فسخ/,
};

async function runOne(question: string) {
  const q = normalizeQuery(question);
  const rules = analyzeQueryRules(q);
  const expansion = await expandQuery(q, rules, { allowLLM: false });
  const { chunks, confidence } = await hybridSearch(q, {}, 8, {
    searchText: expansion.searchText,
    orGroup: expansion.orGroup,
    queryType: rules.queryType,
    legalArea: rules.legalArea,
  });

  const otherSideRe = EXPECT[question];
  const otherSideHit = otherSideRe ? chunks.some((c) => otherSideRe.test(c.chunk_text)) : null;

  return {
    question,
    queryType: rules.queryType,
    n: chunks.length,
    confidence: confidence.label,
    confidenceScore: confidence.score,
    addedTerms: expansion.addedTerms,
    otherSideHit,
    top: chunks.slice(0, 8).map((c) => ({
      id: c.id,
      law: c.law_name ?? c.source_title,
      article: c.article_number,
      matched_by: c.matched_by,
      score: Number(c.score.toFixed(4)),
    })),
  };
}

async function main() {
  const label = process.argv.find((a) => a.startsWith("--label="))?.split("=")[1] ?? "run";
  const results = [];
  for (const q of QUESTIONS) {
    process.stdout.write(".");
    results.push(await runOne(q));
  }
  console.log("");

  for (const r of results) {
    console.log(`\n[${r.queryType}] ${r.question}`);
    console.log(
      `  n=${r.n}  confidence=${r.confidence} (${r.confidenceScore})  addedTerms=${JSON.stringify(r.addedTerms)}  otherSideHit=${r.otherSideHit}`
    );
    for (const t of r.top) console.log(`    #${t.id} [${t.matched_by}] ${t.law} م.${t.article ?? "?"} score=${t.score}`);
  }

  const outPath = `./benchmark/comparison-snapshot-${label}.json`;
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nwrote ${outPath}`);

  const beforePath = "./benchmark/comparison-snapshot-before.json";
  if (label === "after" && existsSync(beforePath)) {
    const before = JSON.parse(readFileSync(beforePath, "utf8"));
    console.log(`\n${"=".repeat(70)}\nBEFORE → AFTER (otherSideHit / n / confidence)\n${"=".repeat(70)}`);
    for (let i = 0; i < results.length; i++) {
      const b = before[i];
      const a = results[i];
      console.log(
        `${a.question.slice(0, 46).padEnd(48)} ${String(b.otherSideHit).padEnd(5)}→${String(a.otherSideHit).padEnd(5)}  n:${b.n}→${a.n}  conf:${b.confidence}→${a.confidence}`
      );
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
