/**
 * Legal AI benchmark — runs benchmark/legal-qa-100.json through the REAL
 * pipeline and reports before/after.
 *
 *   npx tsx scripts/benchmark.ts                # retrieval metrics only (cheap)
 *   npx tsx scripts/benchmark.ts --generate     # + citation/hallucination (paid)
 *   npx tsx scripts/benchmark.ts --only=lab     # filter by id prefix
 *
 * WHAT "BEFORE" AND "AFTER" MEAN
 *   before — the pipeline as it was: one flat relevance floor for every
 *            question, and the lawyer's wording searched verbatim.
 *   after  — query expansion merged into the search text, plus a relevance
 *            floor chosen per query type (search/confidence.ts).
 * Both run the same retriever, corpus and embedding model, so the delta is
 * attributable to those two changes and nothing else.
 *
 * BLOCKED CASES
 * 40 of the 100 target laws whose indexed text is character-corrupted
 * (العقوبات, المدني). They are executed and reported separately but EXCLUDED
 * from headline averages — including them would measure the corpus defect and
 * mask any real movement in the pipeline.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preflightText, runLivePreflight } from "../src/lib/eval/live-preflight";
import { hybridSearch } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { getChatProvider } from "../src/lib/ai";
import { buildChatPrompt, NO_BASIS_ANSWER } from "../src/lib/ai/prompts";
import { normalizeDigits } from "../src/lib/ingest/clean";
import type { RetrievedChunk } from "../src/lib/search/types";

type Case = {
  id: string;
  question: string;
  expected_source: string;
  expected_article: string[] | null;
  difficulty: string;
  queryType: string;
  category: string;
  blocked?: boolean;
};

type CaseResult = {
  id: string;
  category: string;
  blocked: boolean;
  hit: boolean;
  rank: number | null;
  n: number;
  confidence: number;
  refusedUnjustly: boolean;
  citationsTotal: number;
  citationsValid: number;
  hallucinatedArticles: number;
};

const TOP_K = 8;

/** Loose containment so "قانون العمل" matches "قانون العمل رقم 8 لسنة 1996". */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const titleMatches = (chunkTitle: string, expected: string) => norm(chunkTitle).includes(norm(expected));

/**
 * Rank of the first ACCEPTED chunk (1-based), or null.
 * With expected_article set the case is scored at ARTICLE level — the chunk
 * must be one of those articles OF that law. Otherwise at LAW level.
 */
function firstAcceptedRank(chunks: RetrievedChunk[], c: Case): number | null {
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    if (!titleMatches(ch.source_title, c.expected_source)) continue;
    if (c.expected_article && c.expected_article.length > 0) {
      const a = ch.article_number ? normalizeDigits(ch.article_number).trim() : null;
      if (!a || !c.expected_article.includes(a)) continue;
    }
    return i + 1;
  }
  return null;
}

/** Article numbers the ANSWER asserts, e.g. "المادة 32". */
function articlesCitedInAnswer(text: string): string[] {
  const t = normalizeDigits(text);
  return [...t.matchAll(/(?:ال)?ماد[ةه]\s*[({[]?\s*(\d{1,4})/g)].map((m) => m[1]);
}

async function runOne(c: Case, mode: "before" | "after", generate: boolean): Promise<CaseResult> {
  // Same entry-point normalization route.ts applies — the benchmark exists to
  // measure the real pipeline, so it must run the real first step too.
  const question = normalizeQuery(c.question);
  const rules = analyzeQueryRules(question);

  // "before" searches the lawyer's words verbatim with no type-aware floor.
  const exp =
    mode === "after"
      ? await expandQuery(question, rules, { allowLLM: false })
      : { searchText: question, orGroup: "", addedTerms: [] as string[] };

  const { chunks, confidence } = await hybridSearch(question, {}, TOP_K, {
    searchText: exp.searchText,
    orGroup: exp.orGroup,
    ...(mode === "after" ? { queryType: rules.queryType, legalArea: rules.legalArea } : {}),
  });

  const rank = firstAcceptedRank(chunks, c);

  let citationsTotal = 0;
  let citationsValid = 0;
  let hallucinatedArticles = 0;
  let refusedUnjustly = false;

  if (generate && !c.blocked) {
    const { system, user } = buildChatPrompt(question, chunks);
    const provider = getChatProvider();
    let answer = "";
    try {
      answer = (await provider.chat([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 700 })).text;
    } catch {
      answer = "";
    }

    const refused = answer.trim().replace(/^["'“”«»\s]+/, "").startsWith(NO_BASIS_ANSWER);
    // Unjustified refusal: the sources it needed WERE in front of it.
    refusedUnjustly = refused && rank !== null;

    if (!refused && answer) {
      // Citation accuracy: every [n] must point at a source actually supplied.
      const refs = [...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
      citationsTotal = refs.length;
      citationsValid = refs.filter((n) => n >= 1 && n <= chunks.length).length;

      // Hallucination: an article number asserted by the answer that appears
      // in NO retrieved chunk — neither as its article_number nor in its text.
      const grounded = new Set<string>();
      for (const ch of chunks) {
        if (ch.article_number) grounded.add(normalizeDigits(ch.article_number).trim());
        for (const m of normalizeDigits(ch.chunk_text).matchAll(/(?:ال)?ماد[ةه]\s*[({[]?\s*(\d{1,4})/g)) grounded.add(m[1]);
      }
      hallucinatedArticles = articlesCitedInAnswer(answer).filter((a) => !grounded.has(a)).length;
    }
  }

  return {
    id: c.id,
    category: c.category,
    blocked: !!c.blocked,
    hit: rank !== null,
    rank,
    n: chunks.length,
    confidence: confidence.score,
    refusedUnjustly,
    citationsTotal,
    citationsValid,
    hallucinatedArticles,
  };
}

function summarise(rows: CaseResult[]) {
  const n = rows.length || 1;
  const hits = rows.filter((r) => r.hit).length;
  const mrr = rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n;
  const empty = rows.filter((r) => r.n === 0).length;
  const cTot = rows.reduce((s, r) => s + r.citationsTotal, 0);
  const cOk = rows.reduce((s, r) => s + r.citationsValid, 0);
  const halluc = rows.filter((r) => r.hallucinatedArticles > 0).length;
  const generated = rows.filter((r) => r.citationsTotal > 0 || r.refusedUnjustly).length;
  return {
    cases: rows.length,
    recallAt8: hits / n,
    mrr,
    emptyRetrieval: empty / n,
    unjustifiedRefusal: rows.filter((r) => r.refusedUnjustly).length / n,
    citationAccuracy: cTot > 0 ? cOk / cTot : null,
    hallucinationRate: generated > 0 ? halluc / generated : null,
    meanConfidence: rows.reduce((s, r) => s + r.confidence, 0) / n,
  };
}

const pct = (x: number | null) => (x === null ? "  n/a " : `${(x * 100).toFixed(1)}%`.padStart(6));
const num3 = (x: number) => x.toFixed(3).padStart(6);

async function main() {
  const args = process.argv.slice(2);
  const generate = args.includes("--generate");
  const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";

  // Phase 2.1: this measures the REAL corpus — refuse a synthetic or test
  // database, test providers or a missing key (src/lib/eval/live-preflight.ts).
  const pre = await runLivePreflight({ registryPath: resolve(__dirname, "../deploy/sources/required-laws.json"), needChat: generate });
  console.log(preflightText(pre));
  if (!pre.ok) process.exit(2);

  const data = JSON.parse(readFileSync("./benchmark/legal-qa-100.json", "utf8"));
  const cases: Case[] = data.cases.filter((c: Case) => !only || c.id.startsWith(only));

  console.log(`\nحالات: ${cases.length}  |  توليد: ${generate ? "نعم (مدفوع)" : "لا — استرجاع فقط"}`);
  console.log(`معطّلة (نص تالف، تُستثنى من المتوسطات): ${cases.filter((c) => c.blocked).length}\n`);

  const out: Record<string, CaseResult[]> = { before: [], after: [] };
  for (const mode of ["before", "after"] as const) {
    process.stdout.write(`${mode.padEnd(6)} `);
    for (const c of cases) {
      out[mode].push(await runOne(c, mode, generate));
      process.stdout.write(".");
    }
    console.log(" تم");
  }

  const live = (rows: CaseResult[]) => rows.filter((r) => !r.blocked);
  const b = summarise(live(out.before));
  const a = summarise(live(out.after));

  const arrow = (x: number, y: number, higherBetter = true) => {
    const d = y - x;
    if (Math.abs(d) < 0.0005) return "  =";
    const good = higherBetter ? d > 0 : d < 0;
    return `${good ? "▲" : "▼"}${(Math.abs(d) * 100).toFixed(1)}`;
  };

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  تقرير المقارنة — ${b.cases} حالة قابلة للقياس (استُثنيت ${cases.length - b.cases} معطّلة)`);
  console.log("=".repeat(64));
  console.log(`${"المقياس".padEnd(26)} ${"قبل".padStart(7)} ${"بعد".padStart(7)}   الفرق`);
  console.log("-".repeat(64));
  console.log(`${"Recall@8".padEnd(26)} ${pct(b.recallAt8)} ${pct(a.recallAt8)}   ${arrow(b.recallAt8, a.recallAt8)}`);
  console.log(`${"MRR".padEnd(26)} ${num3(b.mrr)} ${num3(a.mrr)}   ${arrow(b.mrr, a.mrr)}`);
  console.log(`${"استرجاع فارغ".padEnd(26)} ${pct(b.emptyRetrieval)} ${pct(a.emptyRetrieval)}   ${arrow(b.emptyRetrieval, a.emptyRetrieval, false)}`);
  console.log(`${"رفض بدون سبب".padEnd(26)} ${pct(b.unjustifiedRefusal)} ${pct(a.unjustifiedRefusal)}   ${arrow(b.unjustifiedRefusal, a.unjustifiedRefusal, false)}`);
  console.log(`${"دقة الاستشهاد".padEnd(26)} ${pct(b.citationAccuracy)} ${pct(a.citationAccuracy)}   ${b.citationAccuracy !== null && a.citationAccuracy !== null ? arrow(b.citationAccuracy, a.citationAccuracy) : ""}`);
  console.log(`${"معدل الهلوسة".padEnd(26)} ${pct(b.hallucinationRate)} ${pct(a.hallucinationRate)}   ${b.hallucinationRate !== null && a.hallucinationRate !== null ? arrow(b.hallucinationRate, a.hallucinationRate, false) : ""}`);
  console.log(`${"متوسط الثقة".padEnd(26)} ${num3(b.meanConfidence)} ${num3(a.meanConfidence)}   ${arrow(b.meanConfidence, a.meanConfidence)}`);

  console.log(`\nحسب الفئة (Recall@8 / MRR — بعد):`);
  const cats = [...new Set(live(out.after).map((r) => r.category))];
  for (const cat of cats) {
    const rb = summarise(live(out.before).filter((r) => r.category === cat));
    const ra = summarise(live(out.after).filter((r) => r.category === cat));
    console.log(
      `  ${cat.padEnd(16)} n=${String(ra.cases).padStart(2)}  ${pct(rb.recallAt8)}→${pct(ra.recallAt8)}   MRR ${num3(rb.mrr)}→${num3(ra.mrr)}`
    );
  }

  const blocked = out.after.filter((r) => r.blocked);
  if (blocked.length) {
    const bl = summarise(blocked);
    console.log(`\nالمعطّلة (نص تالف — للعلم فقط): n=${bl.cases}  Recall@8 ${pct(bl.recallAt8)}  استرجاع فارغ ${pct(bl.emptyRetrieval)}`);
  }

  // Per-case rows the report is built from, so any number can be traced back.
  const report = { generatedAt: new Date().toISOString(), generate, summary: { before: b, after: a }, cases: { before: out.before, after: out.after } };
  writeFileSync("./benchmark/last-run.json", JSON.stringify(report, null, 2), "utf8");
  console.log(`\nالتفاصيل لكل حالة: benchmark/last-run.json\n`);
  // A live run keeps its evidence together (eval:live, deploy/live-corpus-sequence.sh).
  if (process.env.EVAL_RESULTS_DIR) {
    mkdirSync(process.env.EVAL_RESULTS_DIR, { recursive: true });
    writeFileSync(resolve(process.env.EVAL_RESULTS_DIR, `benchmark-${report.generatedAt.slice(0, 10)}.json`), JSON.stringify(report, null, 2), "utf8");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("\nbenchmark failed:", e.message);
  process.exit(1);
});
