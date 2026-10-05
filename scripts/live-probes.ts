/**
 * Phase 2.4 — the pre-registered real-corpus probes (benchmark/live-probes-2.4.json),
 * run through the pipeline as it is served.
 *
 *   npm run eval:probes -- [--answers] [--json out.json] [--md out.md] [--rehearsal] [--only p01,p02]
 *
 * Retrieval (default, read-only): each question takes the pipeline's own steps
 * — normalizeQuery → jurisdiction → analyzeQueryRules → expandQuery →
 * hybridSearch (or comparisonSearch) → the deterministic stops of step 4
 * (pipelines/chat.ts earlyStop / relevantEvidence) — with the configured
 * embedding model and no chat model. It measures what would reach the model,
 * and every stop decided before it.
 * --answers also runs the whole pipeline (runChatPipeline, as Dostoori calls
 * it) on the configured chat model and checks the answer's citations. Paid;
 * records one ai_requests row (metadata only) per question.
 *
 * THE LABEL. "LIVE" only when the live preflight passes against this database,
 * provider probe included (src/lib/eval/live-preflight.ts): real providers
 * answering from this machine, the non-synthetic corpus, integrity-checked,
 * no test vectors. Otherwise the run is refused (exit 2) — or, with
 * --rehearsal on a non-production database, it runs labelled "REHEARSAL — NOT
 * LIVE" with the blocking checks, to test these mechanics on a stand-in. A
 * rehearsal is never a measurement of the corpus.
 *
 * GOLD — structural, from the database, fixed BEFORE any probe runs:
 *   law            the registry law (deploy/sources/required-laws.json)
 *                  resolved against the stored titles (corpus/inventory.ts
 *                  matchRequiredLaw), split into servable and held-back
 *                  sources (corpus/integrity.ts).
 *   titleIncludes  the sources whose title contains every given word.
 * Expected outcome:
 *   expectModes given                    → the mode is one of them
 *   law absent                           → law_not_in_corpus (or expectModesIfAbsent)
 *   law present, no text servable        → law_unavailable
 *   article named, in the servable text  → that article of that law ranks FIRST
 *   article named, not in it             → article_not_in_corpus
 *   law servable                         → a source of the law in the top k
 *   titled sources servable              → one of them in the top k
 *   titled sources absent / held back    → not in corpus / unavailable / no evidence
 *   legislationFirst                     → the class order below holds
 * HARD (one violation fails the run): no chunk of a held-back source is
 * retrieved (or cited); no lower class (interpretation, court decision,
 * memorandum, secondary) outranks an admitted legislative text unless the
 * probe asks for that class or the chunk is the exact citation asked for
 * (corpus/source-class.ts). Expectation misses are the measurement: reported,
 * not fatal.
 *
 * Exit: 0 every hard check holds, 1 a hard check failed, 2 blocked.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getPool, query } from "../src/lib/db";
import { dbTransport } from "../src/lib/db-pool";
import { describeTarget, targetLine } from "../src/lib/db-target";
import { env } from "../src/lib/env";
import { foldForSearch } from "../src/lib/ingest/clean";
import { assessArabicText } from "../src/lib/ingest/quality";
import { isServableSource } from "../src/lib/corpus/integrity";
import { sourceClassOf, type SourceClass } from "../src/lib/corpus/source-class";
import { loadRegistry, matchRequiredLaw } from "../src/lib/corpus/inventory";
import { hybridSearch, type SearchResult } from "../src/lib/search/hybrid";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandQuery } from "../src/lib/search/query-expansion";
import { normalizeQuery } from "../src/lib/search/normalize";
import { detectComparison } from "../src/lib/search/comparison";
import { comparisonSearch } from "../src/lib/search/comparison-search";
import type { RetrievedChunk } from "../src/lib/search/types";
import { checkJurisdiction } from "../src/lib/ai/jurisdiction";
import { earlyStop, missingArticleButAsksMore, relevantEvidence, runChatPipeline, type ChatOutcome } from "../src/lib/ai/pipelines/chat";
import { runAiRequest } from "../src/lib/ai/request";
import { corpusVersion, promptVersion } from "../src/lib/ai/versioning";
import { preflightText, probeProviders, runLivePreflight } from "../src/lib/eval/live-preflight";
import {
  articleKey,
  articlesAsserted,
  GENERATED_MODES,
  classOrderViolations,
  expectationFor,
  integrityVerdict,
  judge,
  titleHas,
  type Expected,
  type Gold,
  type Probe,
  type ProbeGold,
} from "../src/lib/eval/probes";
import type { Caller } from "../src/lib/caller";

const ROOT = resolve(__dirname, "..");
const PROBES_PATH = resolve(ROOT, "benchmark/live-probes-2.4.json");
const REGISTRY_PATH = resolve(ROOT, "deploy/sources/required-laws.json");

type SourceRow = {
  id: number;
  title: string;
  source_type: string;
  status: string;
  jurisdiction: string;
  is_synthetic: boolean;
  integrity_status: string;
  chunks: number;
  sample: string;
};

type ProbeResult = {
  id: string;
  category: string;
  question: string;
  expected: Expected;
  /** The pipeline's decision before generation; "generation" = handed to the model. */
  decided: string;
  finalMode: string | null;
  retrieved: { rank: number; sourceId: number; title: string; article: string | null; class: SourceClass; exactHit: boolean; companion: boolean }[];
  firstGoldRank: number | null;
  goldInTopK: number;
  articleRank: number | null;
  heldBackRetrieved: number[];
  classViolations: string[];
  integrity: { sourceId: number; article: string | null; verdict: string }[];
  notices: { citedSuperseded: boolean; citationMismatch: boolean };
  answer: {
    mode: string;
    citedSources: number[];
    citedNotServable: number[];
    refsTotal: number;
    refsValid: number;
    articlesAsserted: string[];
    articlesUngrounded: string[];
    citesGoldArticle: boolean | null;
  } | null;
  pass: boolean;
  why: string;
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  // A measurement never purges the database it measures (runAiRequest would
  // start the retention purge on the target — a branch copy of production).
  process.env.AUTO_RETENTION = "false";
  const answers = process.argv.includes("--answers");
  const rehearsal = process.argv.includes("--rehearsal");
  const only = (arg("only") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const probeFileText = readFileSync(PROBES_PATH, "utf8");
  const probeFile = JSON.parse(probeFileText) as { k: number; probes: Probe[]; _changes: unknown[] };
  const probes = probeFile.probes.filter((p) => only.length === 0 || only.includes(p.id));
  const k = probeFile.k;
  const target = describeTarget(process.env.DATABASE_URL ?? "");
  console.log(`Target:    ${targetLine(target)}`);
  console.log(`Transport: ${dbTransport()}`);

  // ---- the label
  const pre = await runLivePreflight({ registryPath: REGISTRY_PATH, needChat: answers });
  if (pre.ok) {
    pre.checks.push(...(await probeProviders({ vectorDim: env.embeddingDim, needChat: answers })));
    pre.ok = pre.checks.every((c) => !c.blocking || c.ok);
  }
  console.log(preflightText(pre));
  const live = pre.ok;
  if (!live && !rehearsal) {
    console.log("Probes: BLOCKED — nothing was run. (--rehearsal runs them on a stand-in, labelled NOT LIVE.)");
    await getPool().end().catch(() => undefined);
    process.exit(2);
  }
  if (!live && target.environment === "production") {
    console.log("Probes: a rehearsal never runs against production.");
    await getPool().end().catch(() => undefined);
    process.exit(2);
  }
  const label = live ? (only.length ? "LIVE (PARTIAL — a subset of the probes)" : "LIVE") : "REHEARSAL — NOT LIVE";
  console.log(`\nLabel: ${label}\n`);

  // ---- gold, fixed from the database before any probe runs
  const rows = (
    await query<SourceRow & { id: string }>(
      `SELECT s.id, s.title, s.source_type, s.status, s.jurisdiction, s.is_synthetic, s.integrity_status,
              (SELECT count(*)::int FROM legal_documents d WHERE d.source_id = s.id) AS chunks,
              COALESCE((SELECT left(string_agg(d.chunk_text, E'\\n' ORDER BY d.chunk_index), 12000) FROM legal_documents d WHERE d.source_id = s.id), '') AS sample
         FROM legal_sources s ORDER BY s.id`
    )
  ).map((r) => ({ ...r, id: Number(r.id) }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const servable = (id: number) => {
    const r = byId.get(id);
    return !!r && isServableSource(r, env.allowSyntheticCorpus) && r.chunks > 0;
  };
  const servableIds = rows.filter((r) => servable(r.id)).map((r) => r.id);
  const heldBackAll = new Set(rows.filter((r) => !servable(r.id)).map((r) => r.id));
  const holders = async (ids: number[], article: string): Promise<number[]> => {
    if (!ids.length) return [];
    const arts = await query<{ s: string; a: string }>(
      `SELECT DISTINCT source_id AS s, article_number AS a FROM legal_documents WHERE source_id = ANY($1::bigint[]) AND article_number IS NOT NULL`,
      [ids]
    );
    return [...new Set(arts.filter((r) => articleKey(r.a) === article).map((r) => Number(r.s)))];
  };
  const split = async (ids: number[], article?: string): Promise<Gold> => {
    const ok = ids.filter(servable);
    return { all: ids, servable: ok, heldBack: ids.filter((id) => !servable(id)), articlePresent: article === undefined ? null : (await holders(ok, article)).length > 0 };
  };
  const registry = loadRegistry(REGISTRY_PATH);
  const titles = rows.map((r) => ({ id: r.id, folded: foldForSearch(r.title) }));
  const plan: { p: Probe; gold: ProbeGold; expected: Expected }[] = [];
  for (const p of probes) {
    const law = p.law ? registry.find((l) => l.id === p.law) : undefined;
    if (p.law && !law) throw new Error(`probe ${p.id}: law "${p.law}" is not in the registry — a structural error (record it under _changes)`);
    const gold: ProbeGold = {
      law: law ? await split(matchRequiredLaw(law, titles), p.article) : null,
      title: p.titleIncludes ? await split(rows.filter((r) => p.titleIncludes!.every((t) => titleHas(r.title, t))).map((r) => r.id)) : null,
      articleHolders: p.ambiguousArticle !== undefined ? await holders(servableIds, p.ambiguousArticle) : null,
    };
    plan.push({ p, gold, expected: expectationFor(p, gold) });
  }

  // ---- identity of what is measured
  const identity = {
    label,
    live,
    ranAt: new Date().toISOString(),
    commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || null,
    probeFile: { path: "benchmark/live-probes-2.4.json", sha256: createHash("sha256").update(probeFileText).digest("hex"), changes: probeFile._changes.length },
    target,
    transport: dbTransport(),
    corpusVersion: await corpusVersion(),
    promptVersion: promptVersion(),
    embedding: { provider: env.embeddingProvider, model: env.embeddingModel, dim: env.embeddingDim },
    chat: answers ? { provider: env.chatProvider, model: env.chatProvider === "anthropic" ? env.anthropicModel : env.chatProvider === "openai" ? env.chatModel : env.chatProvider } : null,
    rerank: { provider: env.rerankProvider, model: env.rerankProvider === "none" ? null : env.rerankModel },
    retrieval: { topK: env.topK, scoredAtK: k, llmQueryExpansion: answers && env.queryLlmFallback },
    preflight: pre.checks,
    corpus: pre.corpus,
  };

  const caller = (): Caller => ({
    kind: "service",
    principal: { kind: "service", officeId: "probe-office", userId: "probe-user", requestId: `probe-${Math.random().toString(36).slice(2, 12)}` },
    rateKey: "svc:probe-office:probe-user",
    costKey: "office:probe-office",
    costCapUsd: 1e9,
    retainContent: false,
    ipKey: null,
  });

  const results: ProbeResult[] = [];
  for (const { p, expected } of plan) {
    // ---- the pipeline's steps before generation (pipelines/chat.ts)
    let decided: string;
    let chunks: RetrievedChunk[] = [];
    let search: SearchResult | null = null;
    const question = normalizeQuery(p.question);
    if (checkJurisdiction(p.question).kind === "foreign") {
      decided = "out_of_jurisdiction";
    } else {
      const rules = analyzeQueryRules(question);
      const comparison = detectComparison(question);
      // Without a chat model the LLM query expansion cannot run: retrieval-only
      // probes measure the expansion the ontology gives (recorded in identity).
      const noLlm = answers ? undefined : { allowLLM: false };
      const ctx = { queryType: rules.queryType, legalArea: rules.legalArea };
      if (comparison) {
        chunks = (await comparisonSearch(question, comparison.sideA, comparison.sideB, {}, env.topK, ctx, noLlm)).chunks;
      } else {
        const expansion = await expandQuery(question, rules, noLlm);
        search = await hybridSearch(question, {}, undefined, { searchText: expansion.searchText, orGroup: expansion.orGroup, ...ctx });
        if (answers && search.chunks.length === 0 && !search.requestedLawMissing && rules.queryType !== "fact_pattern" && env.legalQueryExpansion && env.queryLlmFallback) {
          const retryExpansion = await expandQuery(question, rules, { allowLLM: true });
          if (retryExpansion.addedTerms.length > 0) {
            const retry = await hybridSearch(question, {}, undefined, { searchText: retryExpansion.searchText, orGroup: retryExpansion.orGroup, ...ctx });
            if (retry.chunks.length > 0) search = retry;
          }
        }
        chunks = search.chunks;
      }
      const stop = earlyStop(question, search);
      decided = stop
        ? stop.mode
        : relevantEvidence(question, chunks).length > 0
          ? "generation"
          : missingArticleButAsksMore(question, search)
            ? "article_not_in_corpus"
            : "no_evidence";
    }

    const top = chunks.slice(0, k);
    const goldSet = new Set(expected.kind === "retrieve" || expected.kind === "article_first" ? expected.sources : []);
    const heldBackRetrieved = [...new Set(chunks.map((c) => Number(c.source_id)).filter((id) => heldBackAll.has(id)))];
    const classViolations = classOrderViolations(top, p);
    const integrity: ProbeResult["integrity"] = [];
    if (p.articleIntegrity) {
      for (const c of top.filter((x) => goldSet.has(Number(x.source_id)) && x.article_number)) {
        const parts = (
          await query<{ id: string; chunk_index: number; chunk_text: string }>(
            `SELECT id, chunk_index, chunk_text FROM legal_documents WHERE source_id = $1 AND article_number = $2 ORDER BY chunk_index`,
            [c.source_id, c.article_number]
          )
        ).map((x) => ({ ...x, id: Number(x.id), chunk_index: Number(x.chunk_index) }));
        integrity.push({ sourceId: Number(c.source_id), article: c.article_number, verdict: integrityVerdict({ id: Number(c.id), chunk_text: c.chunk_text }, parts) });
      }
    }

    // ---- the answer (--answers): the whole pipeline, as Dostoori calls it
    let answer: ProbeResult["answer"] = null;
    let finalMode: string | null = null;
    if (answers) {
      const who = caller();
      const r = await runAiRequest(who, "chat", undefined, () => runChatPipeline({ question: p.question }, who));
      if (r.ok) {
        const o: ChatOutcome = r.value;
        finalMode = o.mode;
        const cited = o.sources.filter((s) => s.cited);
        const refs = [...o.answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
        const grounded = new Set<string>();
        for (const c of [...chunks.map((x) => ({ a: x.article_number, t: x.chunk_text })), ...o.sources.map((s) => ({ a: s.articleNumber, t: s.excerpt }))]) {
          if (c.a) grounded.add(articleKey(c.a));
          for (const a of articlesAsserted(c.t)) grounded.add(a);
        }
        // Only a generated answer asserts anything: a fixed message (clarification,
        // not in corpus) repeats the article number the question gave.
        const asserted = GENERATED_MODES.includes(o.mode) ? articlesAsserted(o.answer) : [];
        answer = {
          mode: o.mode,
          citedSources: [...new Set(cited.map((s) => s.sourceId))],
          citedNotServable: [...new Set(cited.filter((s) => heldBackAll.has(s.sourceId) || s.integrityStatus !== "passed").map((s) => s.sourceId))],
          refsTotal: refs.length,
          refsValid: refs.filter((n) => o.sources.some((s) => s.ref === n)).length,
          articlesAsserted: asserted,
          articlesUngrounded: asserted.filter((a) => !grounded.has(a)),
          citesGoldArticle: expected.kind === "article_first" ? cited.some((s) => goldSet.has(s.sourceId) && articleKey(s.articleNumber) === expected.article) : null,
        };
      } else {
        finalMode = `request_failed:${r.error}`;
      }
    }

    // ---- the expectation
    const j = judge(expected, { mode: finalMode ?? decided, top, k, classViolations });
    let { pass, why } = j;
    if (pass && p.expectHeldBackOrServableClean && expected.kind === "retrieve") {
      const garbled = expected.sources.filter((id) => assessArabicText(byId.get(id)!.sample).garbled);
      if (garbled.length) {
        pass = false;
        why += `; but servable text(s) ${garbled.join(", ")} read as garbled`;
      }
    }
    if (pass && integrity.some((x) => x.verdict === "part_only" || x.verdict === "excerpt_missing_provisos")) {
      pass = false;
      why += `; article integrity: ${integrity.map((x) => `${x.sourceId}/${x.article} ${x.verdict}`).join(", ")}`;
    }
    if (pass && answer && p.noFabricatedCitation && answer.articlesUngrounded.length > 0) {
      pass = false;
      why += `; the answer asserts article(s) ${answer.articlesUngrounded.join(", ")} found in no retrieved source`;
    }

    results.push({
      id: p.id,
      category: p.category,
      question: p.question,
      expected,
      decided,
      finalMode,
      retrieved: top.map((c, i) => ({
        rank: i + 1,
        sourceId: Number(c.source_id),
        title: c.source_title,
        article: c.article_number,
        class: sourceClassOf(c.source_type, c.source_title),
        exactHit: !!c.exact_hit,
        companion: !!c.companion_of,
      })),
      firstGoldRank: j.firstGoldRank,
      goldInTopK: j.goldInTopK,
      articleRank: j.articleRank,
      heldBackRetrieved,
      classViolations,
      integrity,
      notices: { citedSuperseded: !!(search?.citedVersion && !search.citedVersion.current), citationMismatch: !!search?.citationMismatch },
      answer,
      pass,
      why,
    });
    console.log(
      `${pass ? "✓" : "✗"} ${p.id} ${p.category.padEnd(20)} ${why}${heldBackRetrieved.length ? `  [HELD-BACK RETRIEVED ${heldBackRetrieved.join(", ")}]` : ""}${classViolations.length && expected.kind !== "class_order" ? `  [CLASS ORDER: ${classViolations[0]}]` : ""}`
    );
  }

  // ---- metrics
  const retrieving = results.filter((r) => r.expected.kind === "retrieve" || r.expected.kind === "article_first");
  const articleProbes = results.filter((r) => r.expected.kind === "article_first");
  const modeProbes = results.filter((r) => r.expected.kind === "mode");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const integrityAll = results.flatMap((r) => r.integrity);
  const answered = results.filter((r) => r.answer);
  const generated = answered.filter((r) => GENERATED_MODES.includes(r.answer!.mode));
  const metrics = {
    probes: results.length,
    passed: results.filter((r) => r.pass).length,
    lawLevel: {
      n: retrieving.length,
      recallAtK: avg(retrieving.map((r) => (r.firstGoldRank ? 1 : 0))),
      mrr: avg(retrieving.map((r) => (r.firstGoldRank ? 1 / r.firstGoldRank : 0))),
      precisionAtK: avg(retrieving.map((r) => (r.retrieved.length ? r.goldInTopK / r.retrieved.length : 0))),
    },
    articleLevel: {
      n: articleProbes.length,
      hitAt1: avg(articleProbes.map((r) => (r.articleRank === 1 ? 1 : 0))),
      mrr: avg(articleProbes.map((r) => (r.articleRank ? 1 / r.articleRank : 0))),
    },
    modes: { n: modeProbes.length, correct: modeProbes.filter((r) => r.pass).length },
    articleIntegrity: { checked: integrityAll.length, whole: integrityAll.filter((x) => x.verdict === "whole" || x.verdict === "excerpt_with_provisos").length },
    hard: {
      heldBackRetrieved: results.reduce((n, r) => n + r.heldBackRetrieved.length, 0),
      classOrderViolations: results.reduce((n, r) => n + r.classViolations.length, 0),
      citedNotServable: answered.reduce((n, r) => n + (r.answer?.citedNotServable.length ?? 0), 0),
    },
    citations: answers
      ? {
          answered: answered.length,
          generated: generated.length,
          refsTotal: answered.reduce((n, r) => n + r.answer!.refsTotal, 0),
          refsValid: answered.reduce((n, r) => n + r.answer!.refsValid, 0),
          answersWithUngroundedArticles: generated.filter((r) => r.answer!.articlesUngrounded.length > 0).length,
          namedArticleCited: articleProbes.filter((r) => r.answer?.citesGoldArticle).length,
        }
      : null,
    byCategory: Object.fromEntries(
      [...new Set(results.map((r) => r.category))].map((c) => [c, { n: results.filter((r) => r.category === c).length, passed: results.filter((r) => r.category === c && r.pass).length }])
    ),
  };
  const hardFailed = metrics.hard.heldBackRetrieved + metrics.hard.classOrderViolations + metrics.hard.citedNotServable > 0;

  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const md = [
    `# Real-corpus probes — ${label}`,
    "",
    `- Ran: ${identity.ranAt} · commit ${identity.commit?.slice(0, 12) ?? "unknown"} · probe file sha256 ${identity.probeFile.sha256.slice(0, 16)}… (${identity.probeFile.changes} recorded change(s))`,
    `- Target: ${targetLine(target)} · transport ${identity.transport}`,
    `- Corpus ${identity.corpusVersion} · prompt ${identity.promptVersion} · embedding ${identity.embedding.provider}/${identity.embedding.model} (${identity.embedding.dim}) · rerank ${identity.rerank.provider}${identity.chat ? ` · chat ${identity.chat.provider}/${identity.chat.model}` : " · no chat model (retrieval and pre-generation stops only)"}`,
    live ? "- Preflight: PASS (provider probe included)" : `- Preflight: BLOCKED — ${pre.checks.filter((c) => c.blocking && !c.ok).map((c) => `${c.id}: ${c.detail}`).join("; ")}. **Not a measurement of the corpus.**`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Probes passed | ${metrics.passed} / ${metrics.probes} |`,
    `| Law level (n=${metrics.lawLevel.n}): Recall@${k} · MRR · Precision@${k} | ${pct(metrics.lawLevel.recallAtK)} · ${metrics.lawLevel.mrr?.toFixed(3) ?? "n/a"} · ${pct(metrics.lawLevel.precisionAtK)} |`,
    `| Named article (n=${metrics.articleLevel.n}): Hit@1 · MRR | ${pct(metrics.articleLevel.hitAt1)} · ${metrics.articleLevel.mrr?.toFixed(3) ?? "n/a"} |`,
    `| Designed behaviour (modes) | ${metrics.modes.correct} / ${metrics.modes.n} |`,
    `| Article integrity (whole or with provisos) | ${metrics.articleIntegrity.whole} / ${metrics.articleIntegrity.checked} |`,
    `| HARD: held-back chunks retrieved | ${metrics.hard.heldBackRetrieved} |`,
    `| HARD: class-order violations | ${metrics.hard.classOrderViolations} |`,
    ...(metrics.citations
      ? [
          `| HARD: cited sources not servable | ${metrics.hard.citedNotServable} |`,
          `| Citation refs valid | ${metrics.citations.refsValid} / ${metrics.citations.refsTotal} |`,
          `| Generated answers asserting an article in no retrieved source | ${metrics.citations.answersWithUngroundedArticles} / ${metrics.citations.generated} |`,
          `| Named article cited | ${metrics.citations.namedArticleCited} / ${metrics.articleLevel.n} |`,
        ]
      : []),
    "",
    "| Probe | Category | Expected | Outcome | Pass |",
    "|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.category} | ${r.expected.kind === "mode" ? r.expected.modes.join(" / ") : r.expected.kind}: ${r.expected.why.replace(/\|/g, "/")} | ${r.why.replace(/\|/g, "/")} | ${r.pass ? "✓" : "✗"} |`
    ),
    "",
  ].join("\n");

  const day = identity.ranAt.slice(0, 10);
  const jsonOut = arg("json") ?? resolve(process.env.EVAL_RESULTS_DIR ?? resolve(ROOT, "eval/results"), `${live ? "live" : "rehearsal"}-probes-${day}.json`);
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify({ ...identity, metrics, results }, null, 1));
  const mdOut = arg("md");
  if (mdOut) writeFileSync(mdOut, md);
  console.log(`\n${md}`);
  console.log(`Details: ${jsonOut}`);
  await getPool().end().catch(() => undefined);
  process.exit(hardFailed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("probes failed to run:", (err instanceof Error ? err.message : String(err)).replace(/\/\/[^@\s]+@/g, "//…@"));
  await getPool().end().catch(() => undefined);
  process.exit(2);
});
