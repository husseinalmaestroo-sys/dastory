import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classOrderViolations, expectationFor, integrityVerdict, judge, titleHas, type Gold, type Probe, type ProbeGold } from "@/lib/eval/probes";

/**
 * Phase 2.4: the scoring of the pre-registered real-corpus probes
 * (benchmark/live-probes-2.4.json). The expected outcome is fixed from the
 * database before a probe runs; the safety checks hold whatever the scores.
 */

const gold = (g: Partial<Gold>): Gold => ({ all: [], servable: [], heldBack: [], articlePresent: null, ...g });
const none: ProbeGold = { law: null, title: null, articleHolders: null };
const probe = (p: Partial<Probe>): Probe => ({ id: "t", category: "c", question: "q", ...p });
const chunk = (source_id: number, source_type: string, source_title: string, extra: Record<string, unknown> = {}) => ({
  source_id,
  source_type,
  source_title,
  article_number: null as string | null,
  ...extra,
});

test("a named law: absent, held back, article present or not, servable — each has its own expected outcome", () => {
  const p = probe({ law: "labour" });
  assert.deepEqual(expectationFor(p, { ...none, law: gold({}) }), { kind: "mode", modes: ["law_not_in_corpus"], why: "no source of the law is in this database" });
  const absent = expectationFor(probe({ law: "evidence", expectModesIfAbsent: ["law_not_in_corpus", "law_unavailable"] }), { ...none, law: gold({}) });
  assert.deepEqual(absent.kind === "mode" && absent.modes, ["law_not_in_corpus", "law_unavailable"]);
  const held = expectationFor(probe({ law: "civil" }), { ...none, law: gold({ all: [2], heldBack: [2] }) });
  assert.deepEqual(held.kind === "mode" && held.modes, ["law_unavailable"], "in the database but not servable: unavailable, never 'not in the database'");
  const article = probe({ law: "labour", article: "28" });
  assert.equal(expectationFor(article, { ...none, law: gold({ all: [160], servable: [160], articlePresent: true }) }).kind, "article_first");
  const missing = expectationFor(article, { ...none, law: gold({ all: [160], servable: [160], articlePresent: false }) });
  assert.deepEqual(missing.kind === "mode" && missing.modes, ["article_not_in_corpus"]);
  const retrieve = expectationFor(p, { ...none, law: gold({ all: [160, 200, 3], servable: [160, 200], heldBack: [3] }) });
  assert.deepEqual(retrieve.kind === "retrieve" && retrieve.sources, [160, 200], "only servable sources are gold");
});

test("an article named with no law: clarification only when two or more servable texts hold it", () => {
  const p = probe({ ambiguousArticle: "28" });
  const many = expectationFor(p, { ...none, articleHolders: [10, 11] });
  assert.deepEqual(many.kind === "mode" && many.modes, ["clarification"]);
  const one = expectationFor(p, { ...none, articleHolders: [10] });
  assert.ok(one.kind === "article_first" && one.sources[0] === 10 && one.article === "28");
  const zero = expectationFor(p, { ...none, articleHolders: [] });
  assert.ok(zero.kind === "mode" && zero.modes.includes("no_evidence"));
});

test("titles: a bare number matches whole, words match folded", () => {
  assert.equal(titleHas("قرار الديوان الخاص بتفسير القوانين رقم 30 لسنة 1955", "30"), true);
  assert.equal(titleHas("قرار رقم 1930", "30"), false, "30 is not 1930");
  assert.equal(titleHas("قرار رقم ٣٠ لسنة ١٩٥٥", "30"), true, "Arabic-Indic digits");
  assert.equal(titleHas("مذكرة تفاهم بين وزارة العدل ونقابة المحامين", "مذكره تفاهم"), true);
  assert.equal(titleHas("نظام رسوم الكاتب العدل", "الكاتب العدل"), true);
  assert.equal(titleHas("قانون الكاتب العدل", "نظام"), false);
});

test("class order: a memorandum or secondary text never outranks legislation unless the probe asks for it", () => {
  const law = chunk(1, "law", "قانون العمل");
  const mou = chunk(2, "mou", "مذكرة تفاهم بين وزارة العدل ونقابة المحامين");
  const sec = chunk(3, "template", "لائحة دعوى");
  const dec = chunk(4, "court_decision", "قرار محكمة التمييز");
  assert.deepEqual(classOrderViolations([law, mou, sec], {}), []);
  assert.equal(classOrderViolations([mou, law], {}).length, 1);
  assert.equal(classOrderViolations([sec, dec, law], {}).length, 2, "secondary above a decision, and both above the law");
  assert.deepEqual(classOrderViolations([mou, law], { mouAsked: true }), [], "the question asks about the memorandum");
  assert.deepEqual(classOrderViolations([dec, law], { decisionSeeking: true }), [], "the question asks for decisions");
  assert.deepEqual(classOrderViolations([{ ...mou, exact_hit: true }, law], {}), [], "the exact citation asked for");
  assert.deepEqual(classOrderViolations([mou, { ...law, companion_of: 9 }], {}), [], "a companion appended after is not outranked");
  // A row filed as a decision but titled as a memorandum is a memorandum.
  assert.equal(classOrderViolations([chunk(5, "principle", "مذكرة تفاهم بين جهتين"), law], { decisionSeeking: true }).length, 1);
});

test("article integrity: whole, an excerpt with its provisos, or a part cut from its condition", () => {
  const parts = [
    { id: 1, chunk_index: 4, chunk_text: "المادة 28: يجوز لصاحب العمل أن ينهي خدمة العامل دون إشعار في الحالات التالية." },
    { id: 2, chunk_index: 5, chunk_text: "أ. إذا انتحل العامل شخصية غيره. ب. إذا لم يقم بالتزاماته، على أن يكون قد أنذر كتابياً مرتين." },
    { id: 3, chunk_index: 9, chunk_text: "المادة 28 (تكرار في نص سيئ الترقيم) نص آخر." },
  ];
  const whole = { id: 1, chunk_text: `${parts[0].chunk_text}\n${parts[1].chunk_text}` };
  assert.equal(integrityVerdict(whole, parts), "whole");
  assert.equal(integrityVerdict({ id: 1, chunk_text: parts[0].chunk_text }, parts), "part_only");
  assert.equal(integrityVerdict({ id: 3, chunk_text: parts[2].chunk_text }, parts), "whole", "a non-contiguous repeat is another article");
  // mergeArticleParts carries each proviso sentence whole (" … " + the sentence).
  assert.equal(integrityVerdict({ id: 1, chunk_text: `…${parts[0].chunk_text}… … إذا لم يقم بالتزاماته، على أن يكون قد أنذر كتابياً مرتين.` }, parts), "excerpt_with_provisos");
  assert.equal(integrityVerdict({ id: 1, chunk_text: `…${parts[0].chunk_text}…` }, parts), "excerpt_missing_provisos");
});

test("judging: a mode, the named article first, the law in the top k; 'generation' satisfies only a list of every generated mode", () => {
  const top = [chunk(7, "law", "قانون التجارة", { article_number: "6" }), chunk(7, "law", "قانون التجارة", { article_number: "٥" })];
  const article = judge({ kind: "article_first", sources: [7], article: "5", why: "" }, { mode: "generation", top, k: 8, classViolations: [] });
  assert.equal(article.pass, false);
  assert.equal(article.articleRank, 2, "Arabic-Indic digits compared as digits");
  assert.equal(judge({ kind: "retrieve", sources: [7], why: "" }, { mode: "generation", top, k: 8, classViolations: [] }).firstGoldRank, 1);
  assert.equal(judge({ kind: "mode", modes: ["clarification"], why: "" }, { mode: "generation", top, k: 8, classViolations: [] }).pass, false);
  assert.equal(
    judge({ kind: "mode", modes: ["clarification", "grounded", "partial", "sources_only", "no_evidence"], why: "" }, { mode: "generation", top, k: 8, classViolations: [] }).pass,
    true
  );
  assert.equal(judge({ kind: "class_order", why: "" }, { mode: "generation", top, k: 8, classViolations: ["x"] }).pass, false);
});

test("the probe file: every probe derives an expectation; nothing in it encodes legal content", () => {
  const file = JSON.parse(readFileSync(resolve(__dirname, "../../benchmark/live-probes-2.4.json"), "utf8")) as { probes: Probe[]; _changes: unknown[] };
  assert.equal(file.probes.length, 32);
  assert.equal(new Set(file.probes.map((p) => p.id)).size, 32);
  const anyGold: ProbeGold = { law: gold({ all: [1], servable: [1], articlePresent: true }), title: gold({ all: [1], servable: [1] }), articleHolders: [1, 2] };
  for (const p of file.probes) assert.doesNotThrow(() => expectationFor(p, anyGold), p.id);
  const allowed = new Set([
    "id", "category", "question", "law", "article", "ambiguousArticle", "expectModes", "expectModesIfAbsent", "expectHeldBackOrServableClean",
    "titleIncludes", "decisionSeeking", "mouAsked", "legislationFirst", "historical", "noFabricatedCitation", "articleIntegrity",
  ]);
  for (const p of file.probes) for (const key of Object.keys(p)) assert.ok(allowed.has(key), `${p.id}: unexpected field ${key} (no answer text, no expected article content)`);
  const categories = new Set(file.probes.map((p) => p.category));
  assert.ok(categories.size >= 14, "at least the fourteen query types of Phase 2.4");
});
