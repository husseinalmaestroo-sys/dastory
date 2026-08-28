/**
 * Reranker benchmark — measures whether a cross-encoder actually improves
 * retrieval before anyone switches it on in production.
 *
 *   npx tsx scripts/benchmark-rerank.ts                # every available variant
 *   npx tsx scripts/benchmark-rerank.ts --variant=cohere --verbose
 *
 * Options:
 *   --variant=<baseline|cohere|voyage>  Run one variant. Default: all available.
 *   --verbose                           Print the full before/after ordering
 *                                       for every question, not just a summary.
 *   --top-k=<n>                         Final cut. Default 8.
 *
 * A variant is skipped when its API key is missing — the run still reports the
 * others rather than failing, so the baseline is always measurable.
 *
 * PIPELINE UNDER TEST (identical to production, one flag apart):
 *   query expansion → hybrid search (wide) → rerank → top-K
 *
 * METRICS
 *   hit@K  — the expected law appears somewhere in the final K. Recall: did we
 *            put the right authority in front of the model at all?
 *   rank   — 1-based position of the first chunk from the expected law.
 *   MRR    — mean of 1/rank over all cases. Rewards ranking it FIRST, which is
 *            what a reranker is supposed to buy; hit@K alone can't see that.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hybridSearch } from "../src/lib/search/hybrid";
import { expandQuery } from "../src/lib/search/query-expansion";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { normalizeQuery } from "../src/lib/search/normalize";

type Case = { question: string; expectLaw: string; expectArticles?: string[]; note?: string };
type Variant = { name: string; rerank?: { provider: string; model?: string } };

type CaseResult = {
  question: string;
  expectLaw: string;
  hit: boolean;
  rank: number | null;
  top: { title: string; article: string | null; score: number }[];
  trace: unknown;
};

function metrics(results: CaseResult[]) {
  const n = results.length;
  const hits = results.filter((r) => r.hit).length;
  const mrr = results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n;
  const ranked = results.filter((r) => r.rank !== null).map((r) => r.rank!);
  const meanRank = ranked.length ? ranked.reduce((a, b) => a + b, 0) / ranked.length : NaN;
  const top1 = results.filter((r) => r.rank === 1).length;
  return { n, hits, hitRate: hits / n, mrr, meanRank, top1 };
}

async function runVariant(v: Variant, cases: Case[], topK: number, verbose: boolean): Promise<CaseResult[]> {
  const out: CaseResult[] = [];

  for (const c of cases) {
    // Same front half as production: normalize, then rules-tier analysis
    // gates the expansion.
    const question = normalizeQuery(c.question);
    const rules = analyzeQueryRules(question);
    const expansion = await expandQuery(question, rules);

    const { chunks, rerankTrace } = await hybridSearch(question, {}, topK, {
      searchText: expansion.searchText,
      orGroup: expansion.orGroup,
      queryType: rules.queryType,
      legalArea: rules.legalArea,
      rerank: v.rerank ?? { provider: "none" },
    });

    // Article-level when the case pins specific articles, else law-level. The
    // article-level cases are the ones with headroom — law-level alone is
    // saturated on this corpus and cannot tell two rerankers apart.
    const accepts = (ch: { source_title: string; article_number: string | null }) => {
      if (!(ch.source_title ?? "").includes(c.expectLaw)) return false;
      if (!c.expectArticles?.length) return true;
      return c.expectArticles.includes(String(ch.article_number ?? ""));
    };
    const idx = chunks.findIndex(accepts);
    out.push({
      question: c.question,
      expectLaw: c.expectLaw,
      hit: idx !== -1,
      rank: idx === -1 ? null : idx + 1,
      top: chunks.slice(0, 5).map((ch) => ({
        title: ch.source_title,
        article: ch.article_number,
        score: Number((ch.rerank_score ?? ch.score).toFixed(4)),
      })),
      trace: rerankTrace,
    });

    if (verbose) {
      const r = out[out.length - 1];
      console.log(`\n  ${r.hit ? "✓" : "✗"} ${c.question}`);
      console.log(`     متوقع: ${c.expectLaw}  |  رتبة أول تطابق: ${r.rank ?? "—"}`);
      for (const [i, t] of r.top.entries()) {
        console.log(`       ${i + 1}. [${String(t.score).padEnd(7)}] ${t.title.slice(0, 46)}${t.article ? ` — م.${t.article}` : ""}`);
      }
      if (rerankTrace) {
        console.log(`     قبل rerank: ${rerankTrace.before.slice(0, 6).map((b) => `#${b.id}(${b.rrfScore})`).join(" ")}`);
        console.log(`     بعد rerank: ${rerankTrace.after.slice(0, 6).map((a) => `#${a.id}(${a.rerankScore})←${a.movedFrom}`).join(" ")}`);
      }
    } else {
      process.stdout.write(out[out.length - 1].hit ? "." : "x");
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? null;
  const only = get("variant");
  const verbose = args.includes("--verbose");
  const topK = Number(get("top-k") ?? 8);

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set — retrieval embeds the query.");

  const file = JSON.parse(readFileSync(resolve(process.cwd(), "benchmark/rerank-eval.json"), "utf8"));
  const cases: Case[] = file.cases;

  // A variant needs its key, or it cannot be measured — say so rather than
  // reporting a silent zero.
  const all: (Variant & { available: boolean; why?: string })[] = [
    { name: "baseline (RRF only)", available: true },
    // Free, local, non-GPT composite reranker (search/local-rerank.ts) — no
    // key needed, so it's always available to compare against the baseline.
    { name: "local", rerank: { provider: "local" }, available: true },
    {
      name: "cohere",
      rerank: { provider: "cohere", model: process.env.RERANK_MODEL ?? undefined },
      available: !!process.env.COHERE_API_KEY,
      why: "COHERE_API_KEY not set",
    },
    {
      name: "voyage",
      rerank: { provider: "voyage", model: process.env.RERANK_MODEL ?? undefined },
      available: !!process.env.VOYAGE_API_KEY,
      why: "VOYAGE_API_KEY not set",
    },
  ];

  const variants = all.filter((v) => (only ? v.name.startsWith(only) : true));

  console.log(`\n${"=".repeat(72)}`);
  console.log(`  Reranker benchmark — ${cases.length} cases, top-${topK}`);
  console.log(`${"=".repeat(72)}`);

  const summaries: { name: string; m: ReturnType<typeof metrics> }[] = [];

  for (const v of variants) {
    if (!v.available) {
      console.log(`\n[${v.name}]  SKIPPED — ${v.why}`);
      continue;
    }
    console.log(`\n[${v.name}]`);
    const results = await runVariant(v, cases, topK, verbose);
    const m = metrics(results);
    summaries.push({ name: v.name, m });
    if (!verbose) console.log("");
    console.log(
      `  hit@${topK}: ${m.hits}/${m.n} (${(m.hitRate * 100).toFixed(0)}%)   MRR: ${m.mrr.toFixed(3)}   ` +
        `mean rank: ${Number.isNaN(m.meanRank) ? "—" : m.meanRank.toFixed(2)}   ranked #1: ${m.top1}/${m.n}`
    );

    // Article-level subset reported separately: that is the discriminating
    // half, and averaging it with the saturated law-level cases hides movement.
    const artIdx = cases.map((c, i) => (c.expectArticles?.length ? i : -1)).filter((i) => i >= 0);
    if (artIdx.length) {
      const am = metrics(artIdx.map((i) => results[i]));
      console.log(
        `    └ article-level subset (${am.n}): hit ${am.hits}/${am.n}   MRR ${am.mrr.toFixed(3)}   ` +
          `mean rank ${Number.isNaN(am.meanRank) ? "—" : am.meanRank.toFixed(2)}   #1 ${am.top1}/${am.n}`
      );
    }
    // Show the misses — they are what a reranker would have to fix.
    const misses = results.filter((r) => !r.hit);
    if (misses.length) {
      console.log(`  أخفق في:`);
      for (const miss of misses) console.log(`    - ${miss.question}  (متوقع: ${miss.expectLaw})`);
    }
  }

  if (summaries.length > 1) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`  المقارنة`);
    console.log(`${"=".repeat(72)}`);
    console.log(`  ${"variant".padEnd(22)} ${"hit@K".padEnd(10)} ${"MRR".padEnd(8)} ${"mean rank".padEnd(10)} #1`);
    for (const s of summaries) {
      console.log(
        `  ${s.name.padEnd(22)} ${`${s.m.hits}/${s.m.n}`.padEnd(10)} ${s.m.mrr.toFixed(3).padEnd(8)} ` +
          `${(Number.isNaN(s.m.meanRank) ? "—" : s.m.meanRank.toFixed(2)).padEnd(10)} ${s.m.top1}`
      );
    }
    const base = summaries.find((s) => s.name.startsWith("baseline"));
    const best = summaries.filter((s) => s !== base).sort((a, b) => b.m.mrr - a.m.mrr)[0];
    if (base && best) {
      const delta = best.m.mrr - base.m.mrr;
      console.log(
        `\n  ${best.name} vs baseline: MRR ${delta >= 0 ? "+" : ""}${delta.toFixed(3)} — ` +
          (delta > 0.02
            ? "تحسّن حقيقي، يستحق التفعيل."
            : delta < -0.02
              ? "تراجع — لا تفعّله."
              : "الفرق ضمن الضجيج على هذا الحجم؛ وسّع مجموعة الاختبار قبل الحكم.")
      );
    }
  } else {
    console.log(`\n  لم يُقارَن أي reranker — المفاتيح غير متوفرة. القياس أعلاه هو خط الأساس فقط.`);
  }
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nbenchmark failed:", err.message);
  process.exit(1);
});
