import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { integrityVerdict, isGarbledChunk, isPartOfLaw, missingArticleRatio } from "@/lib/corpus/check";
import {
  loadRepairManifest,
  planRepairs,
  servingBlockers,
  validateRepairManifest,
  type RepairManifest,
  type RepairSourceRow,
} from "@/lib/corpus/repairs";
import { classTier, expectedSourceType, orderBySourceClass, seeksDecisions, seeksMou, sourceClassOf } from "@/lib/corpus/source-class";
import { crossCheckRegistry, loadRegistrySources } from "@/lib/corpus/registry-check";
import { loadRegistry } from "@/lib/corpus/inventory";
import { framedLawYear } from "@/lib/corpus/maintenance";
import { classifySource } from "@/lib/ingest/classify";
import { normalizeTitle, titleProblems } from "@/lib/ingest/title";
import { parseLawNumber, parseLawYear, isAmendingTitle } from "@/lib/ingest/law-identity";

/**
 * Corpus repair (2026-10), the pure halves: the integrity verdict every text
 * must pass before it is served, the known-defect manifest, source classes in
 * ranking, title / number / year normalisation, and the required-law registry
 * against the repository's own records.
 */

const ROOT = resolve(__dirname, "../..");
const garble = (t: string) =>
  [...t].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x0621 && c <= 0x064a ? String.fromCharCode(0x0621 + (((c - 0x0621) * 5 + 11) % 42)) : ch;
  }).join("");
const ARTICLE = (n: number) =>
  `المادة ${n}: يلتزم صاحب العمل بأن يدفع للعامل أجره كاملاً في موعد لا يتجاوز سبعة أيام من تاريخ استحقاقه، ولا يجوز له أن يقتطع منه أي مبلغ إلا في الحالات التي ينص عليها هذا القانون أو الأنظمة الصادرة بمقتضاه، وعلى المحكمة المختصة أن تنظر في أي نزاع ينشأ عن ذلك على وجه الاستعجال. `.repeat(3);

// ---------------------------------------------------------------- integrity verdict

test("integrity verdict: a sound text passes; empty, garbled, mostly-unreadable or gap-ridden statutes are quarantined", () => {
  const clean = Array.from({ length: 10 }, (_, i) => ARTICLE(i + 1));
  const articles = clean.map((_, i) => String(i + 1));
  assert.deepEqual(integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean, articles }), { verdict: "passed", findings: [] });

  assert.equal(integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: [], articles: [] }).verdict, "quarantined");
  const garbled = integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean.map(garble), articles });
  assert.equal(garbled.verdict, "quarantined");
  assert.ok(garbled.findings.some((f) => f.kind === "garbled_text" && f.blocking));

  // One garbled page in ten: reported, not blocking. Two in ten (> 10%): quarantined.
  const one = integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean.map((t, i) => (i === 0 ? garble(t) : t)), articles });
  assert.equal(one.verdict, "passed");
  assert.ok(one.findings.some((f) => f.kind === "garbled_chunks" && !f.blocking));
  const two = integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean.map((t, i) => (i < 2 ? garble(t) : t)), articles });
  assert.equal(two.verdict, "quarantined");

  // Article numbering: a fifth missing is tolerated (reported), more is not — for real statutes only.
  const gappy = (n: number) => clean.map((_, i) => String(i < 10 - n ? i + 1 : 50 + i)); // n numbers jump far ahead
  assert.equal(integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean, articles: gappy(1) }).verdict, "quarantined");
  const small = integrityVerdict({ sourceType: "law", isSynthetic: false, chunkTexts: clean, articles: ["1", "2", "3", "4", "6", "7", "8", "9", "10", "10"] });
  assert.equal(small.verdict, "passed");
  assert.ok(small.findings.some((f) => f.kind === "article_gaps" && !f.blocking));
  assert.equal(integrityVerdict({ sourceType: "court_decision", isSynthetic: false, chunkTexts: clean, articles: gappy(1) }).verdict, "passed", "a decision has no article sequence");
  assert.equal(integrityVerdict({ sourceType: "law", isSynthetic: true, chunkTexts: clean, articles: gappy(1) }).verdict, "passed", "fixtures carry excerpts");

  assert.equal(isGarbledChunk(garble(ARTICLE(1))), true);
  assert.equal(isGarbledChunk(ARTICLE(1)), false);
  assert.equal(isGarbledChunk(garble("المادة 1 قصيرة")), false, "too short to judge alone");
  assert.equal(missingArticleRatio(["1", "2", "5"]).missingRatio, 2 / 5);
  // One part of a law — the Constitution is ingested as ten chapter files — is
  // measured from its own first article; a whole law with the same numbers is not.
  const chapter = ["40", "41", "42", "43", "44", "45"];
  assert.equal(isPartOfLaw("الدستور الأردني — الفصل05"), true);
  assert.equal(isPartOfLaw("الدستور الأردني - الفصل الخامس"), true);
  assert.equal(isPartOfLaw("قانون تقسيم الأراضي وإفرازها"), false);
  assert.equal(isPartOfLaw("قانون العمل رقم 8 لسنة 1996"), false);
  assert.equal(integrityVerdict({ sourceType: "law", isSynthetic: false, title: "الدستور الأردني — الفصل05", chunkTexts: chapter.map((n) => ARTICLE(Number(n))), articles: chapter }).verdict, "passed");
  assert.equal(integrityVerdict({ sourceType: "law", isSynthetic: false, title: "قانون العمل رقم 8 لسنة 1996", chunkTexts: chapter.map((n) => ARTICLE(Number(n))), articles: chapter }).verdict, "quarantined", "a whole law starting at article 40 has lost its beginning");
  assert.equal(missingArticleRatio(["١", "٢", "٣"]).missingRatio, 0, "Arabic-Indic digits count");
});

// ---------------------------------------------------------------- the known-defect manifest

const row = (over: Partial<RepairSourceRow> & { id: number; title: string }): RepairSourceRow => ({
  source_type: "law",
  file_path: null,
  note: null,
  provenance: null,
  integrity_status: "passed",
  status: "ready",
  jurisdiction: "JO",
  is_synthetic: false,
  ...over,
});

test("the repository's manifest is valid, quarantines the Civil Code as a launch blocker, and adds no text, number, year or Gazette claim", () => {
  const m = loadRepairManifest(resolve(ROOT, "deploy/sources/corpus-repairs.json"));
  assert.deepEqual(validateRepairManifest(m), []);
  const civil = m.repairs.find((r) => r.id === "civil-code-43-1976-corrupted")!;
  assert.deepEqual([civil.action, civil.launchBlocker, civil.match.sourceId], ["quarantine", true, 2]);
  assert.ok(civil.match.titleIncludesAll?.includes("المدني"), "the id alone never decides");
  for (const r of m.repairs) {
    assert.ok(r.evidence.trim().length > 0, `${r.id} cites its record`);
    assert.ok(!JSON.stringify(r.params ?? {}).includes("gazette"), `${r.id} sets no Gazette status`);
    if (r.action === "retitle") assert.ok(!/\d/.test(String(r.params?.title)), `${r.id} invents no number or year`);
    if (r.action === "set_provenance") assert.ok(["official", "secondary"].includes(String(r.params?.provenance)));
  }
  const penal = m.repairs.find((r) => r.id === "penal-code-16-1960-secondary")!;
  assert.equal(penal.params?.provenance, "secondary", "the Penal Code in service is a secondary republication");
});

test("manifest validation refuses an unsafe entry", () => {
  const base = { reason: "r", evidence: "e" };
  const errors = validateRepairManifest({
    repairs: [
      { ...base, id: "a", action: "quarantine", match: { sourceId: 2 } },
      { ...base, id: "b", action: "set_provenance", match: { titleEquals: "x" }, params: { provenance: "synthetic" } },
      { ...base, id: "c", action: "retitle", match: { titleEquals: "قانون الملكية العقارية لسنة أحكام عامة" }, params: { title: "قانون الملكية العقارية رقم 13 لسنة 2019" } },
      { ...base, id: "d", action: "reclassify", match: { titleEquals: "x" }, params: { sourceType: "law" }, launchBlocker: true },
      { ...base, id: "d", action: "explode", match: { titleEquals: "x" } },
      { id: "e", action: "review", match: {}, reason: "", evidence: "" },
    ],
  } as unknown as RepairManifest);
  const has = (id: string, re: RegExp) => assert.ok(errors.some((e) => e.includes(`(${id})`) && re.test(e)), `${id} ${re}: ${errors.join(" / ")}`);
  has("a", /must also check the title/);
  has("b", /'official' or 'secondary'/);
  has("c", /may not introduce a number/);
  has("d", /only a quarantine entry can be a launch blocker/);
  has("d", /duplicate id/);
  has("e", /reason is required/);
  has("e", /evidence is required/);
  has("e", /needs a selector/);
});

test("planning: an id is honoured only with its title; title matches are bounded; recorded values are never overwritten; fixtures are never touched", () => {
  const manifest: RepairManifest = {
    repairs: [
      { id: "civil", action: "quarantine", match: { sourceId: 2, titleIncludesAll: ["المدني"] }, launchBlocker: true, reason: "corrupt", evidence: "e" },
      { id: "penal-old", action: "quarantine", match: { sourceId: 3, titleIncludesAll: ["العقوبات"] }, launchBlocker: true, reason: "corrupt", evidence: "e" },
      { id: "lob", action: "set_provenance", match: { sourceId: 159, titleIncludesAll: ["التجارة"] }, params: { provenance: "official", authority: "ديوان التشريع والرأي" }, reason: "r", evidence: "e" },
      { id: "secondary", action: "set_provenance", match: { sourceId: 170, titleIncludesAll: ["العقوبات"] }, params: { provenance: "secondary" }, reason: "r", evidence: "e" },
      { id: "rp", action: "retitle", match: { titleEquals: "قانون الملكية العقارية لسنة أحكام عامة" }, params: { title: "قانون الملكية العقارية" }, reason: "r", evidence: "e" },
      { id: "mou", action: "reclassify", match: { titleStartsWith: "مذكرة تفاهم", sourceType: ["instruction"], maxMatches: 2 }, params: { sourceType: "mou" }, reason: "r", evidence: "e" },
      { id: "greedy", action: "reclassify", match: { titleStartsWith: "قانون", maxMatches: 1 }, params: { sourceType: "secondary" }, reason: "r", evidence: "e" },
      { id: "look", action: "review", match: { titleEquals: "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته", noteIncludes: "iclc-law.com" }, reason: "compare", evidence: "e" },
      { id: "gone", action: "quarantine", match: { sourceId: 999, titleIncludesAll: ["x"] }, reason: "r", evidence: "e" },
    ],
  };
  const rows = [
    row({ id: 2, title: "القانون المدني رقم 43 لسنة 1976" }),
    row({ id: 3, title: "قانون التجارة رقم 12 لسنة 1966" }), // NOT the penal code: another database's id 3
    row({ id: 159, title: "قانـون التجارة الأردني رقم 12 لسنة 1966" }),
    row({ id: 170, title: "قانون العقوبات الأردني مع كامل التعديلات", provenance: "official" }),
    row({ id: 200, title: "قانون الملكية العقارية لسنة أحكام عامة" }),
    row({ id: 201, title: "مذكرة تفاهم بين وزارة العدل والأمن العام", source_type: "instruction" }),
    row({ id: 202, title: "مذكرة تفاهم بين وزارة العدل ونقابة المحامين", source_type: "mou" }),
    row({ id: 203, title: "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته", note: "نص المادة … (iclc-law.com، jordan-lawyer.com)" }),
    row({ id: 204, title: "قانون العمل الأردني رقم 8 لسنة 1996 وتعديلاته", note: "lob" }),
    row({ id: 300, title: "مذكرة تفاهم تجريبية", source_type: "instruction", is_synthetic: true }),
  ];
  const plan = planRepairs(manifest, rows);
  const outcome = (id: string) => plan.filter((p) => p.id === id).map((p) => `${p.sourceId}:${p.outcome}`);
  assert.deepEqual(outcome("civil"), ["2:apply"]);
  assert.deepEqual(outcome("penal-old"), ["3:mismatch"], "id 3 holds another law: nothing is quarantined");
  assert.deepEqual(outcome("lob"), ["159:apply"], "tatweel does not defeat the title check");
  assert.deepEqual(outcome("secondary"), ["170:conflict"], "a recorded provenance is never overwritten");
  assert.deepEqual(outcome("rp"), ["200:apply"]);
  assert.equal(plan.find((p) => p.id === "rp")!.to, "قانون الملكية العقارية");
  assert.deepEqual(outcome("mou"), ["201:apply", "202:already"], "an already-reclassified memorandum counts as done");
  assert.deepEqual(outcome("greedy"), ["null:too_many"], "a broad match touches nothing");
  assert.deepEqual(outcome("look"), ["203:review"], "the note tells the hand-added article from the full law");
  assert.deepEqual(outcome("gone"), ["999:not_found"]);
  assert.ok(!plan.some((p) => p.sourceId === 300), "a fixture is never a candidate");

  // Applied before (event log) and no longer matching: reported done, not missing.
  const after = planRepairs(manifest, rows.map((r) => (r.id === 200 ? { ...r, title: "قانون الملكية العقارية" } : r)), [{ repairId: "rp", sourceId: 200 }]);
  assert.deepEqual(after.filter((p) => p.id === "rp").map((p) => p.outcome), ["already"]);
});

test("launch blockers: the corrupted Civil Code blocks while it can be served; quarantined, replaced or absent, it does not", () => {
  const m: RepairManifest = {
    repairs: [{ id: "civil", action: "quarantine", match: { sourceId: 2, titleIncludesAll: ["المدني"] }, launchBlocker: true, reason: "corrupt", evidence: "e" }],
  };
  const civil = (over: Partial<RepairSourceRow>) => [row({ id: 2, title: "القانون المدني رقم 43 لسنة 1976", ...over })];
  assert.equal(servingBlockers(m, civil({})).length, 1);
  assert.equal(servingBlockers(m, civil({ integrity_status: "unchecked" })).length, 0, "unchecked is not served");
  assert.equal(servingBlockers(m, civil({ integrity_status: "quarantined" })).length, 0);
  assert.equal(servingBlockers(m, civil({ integrity_status: "replaced" })).length, 0);
  assert.equal(servingBlockers(m, []).length, 0, "not in this database");
  assert.match(servingBlockers(m, [row({ id: 2, title: "قانون العمل رقم 8 لسنة 1996" })])[0].detail, /cannot confirm/, "an id holding another law cannot be confirmed safe");
});

// ---------------------------------------------------------------- source classes in ranking

const hit = (source_type: string, source_title: string, exact_hit = false) => ({ source_type, source_title, exact_hit });

test("source classes: a memorandum, a secondary text or a decision never outranks an admitted legislative article — unless the question asks for it", () => {
  assert.equal(sourceClassOf("instruction", "مذكرة تفاهم بين وزارة العدل والأمن العام"), "mou", "old rows are classified by title");
  assert.equal(sourceClassOf("principle", "قرار الديوان الخاص بتفسير القوانين رقم 3 لسنة 2010"), "interpretation");
  assert.equal(sourceClassOf("principle", "مبدأ قانوني في التقادم"), "court_decision");
  assert.equal(sourceClassOf("template", "لائحة دعوى"), "secondary");
  assert.equal(sourceClassOf("regulation"), "regulation");
  assert.ok(classTier("legislation") === classTier("regulation") && classTier("regulation") === classTier("instruction"));
  assert.ok(classTier("instruction") < classTier("interpretation") && classTier("interpretation") < classTier("court_decision") && classTier("court_decision") < classTier("mou"));
  assert.equal(expectedSourceType("instruction", "مذكرة تفاهم بين …"), "mou");
  assert.equal(expectedSourceType("principle", "قرار الديوان الخاص بتفسير القوانين"), "interpretation");
  // The production corpus filed them as court decisions (live run, 2026-10-06: ids 71-150).
  assert.equal(sourceClassOf("court_decision", "قرار الديوان الخاص بتفسير القوانين — 30"), "interpretation");
  assert.equal(expectedSourceType("court_decision", "قرار الديوان الخاص بتفسير القوانين — 30"), "interpretation", "the class audit flags them");
  assert.equal(sourceClassOf("court_decision", "قرار المحكمة الادارية العليا"), "court_decision", "a court decision stays one");
  assert.equal(expectedSourceType("court_decision", "قرار المحكمة الادارية العليا"), null);
  assert.equal(expectedSourceType("interpretation", "قرار الديوان الخاص بتفسير القوانين — 30"), null, "already right: nothing to flag");

  // In score order: the memorandum and the decision are lexically closer than the law.
  const ranked = [
    hit("instruction", "مذكرة تفاهم بين وزارة العدل والأمن العام"),
    hit("court_decision", "قرار محكمة التمييز رقم 1234 لسنة 2020"),
    hit("template", "لائحة دعوى مطالبة عمالية"),
    hit("law", "قانون العمل رقم 8 لسنة 1996"),
    hit("regulation", "نظام العمل المرن"),
  ];
  const order = (q: string, decision = false) => orderBySourceClass(ranked, q, { hasDecisionNumber: decision }).map((c) => c.source_title.split(" ")[0]);
  assert.deepEqual(order("ما حقوق العامل عند إنهاء عقده؟"), ["قانون", "نظام", "قرار", "مذكرة", "لائحة"]);
  assert.deepEqual(order("ما حكم القانون في فصل العامل دون إشعار؟"), ["قانون", "نظام", "قرار", "مذكرة", "لائحة"], "\"ما حكم\" asks for the rule, not for a judgment");
  assert.deepEqual(order("ما اجتهاد محكمة التمييز في الفصل التعسفي؟"), ["قرار", "قانون", "نظام", "مذكرة", "لائحة"], "asked for decisions: by score with legislation");
  assert.deepEqual(order("القرار 1234/2020", true), ["قرار", "قانون", "نظام", "مذكرة", "لائحة"]);
  assert.deepEqual(order("ما الذي تنص عليه مذكرة التفاهم بين وزارة العدل والأمن العام؟"), ["مذكرة", "قانون", "نظام", "قرار", "لائحة"], "asked about the memorandum");
  // The citation the lawyer named ranks in the first class, whatever its own.
  const exact = orderBySourceClass(
    [hit("instruction", "مذكرة تفاهم بين وزارة العدل والأمن العام"), hit("court_decision", "قرار رقم 77/2021", true), hit("law", "قانون العمل")],
    "ما رأيك بهذا؟"
  );
  assert.deepEqual(exact.map((c) => c.source_type), ["court_decision", "law", "instruction"]);
  // The gap cutoff runs within a class: a cliff after the decisions never trims the law.
  const cut = orderBySourceClass(ranked, "ما حقوق العامل؟", { cutoff: (tier) => tier.slice(0, 1) });
  assert.deepEqual(cut.map((c) => c.source_type), ["law", "court_decision", "instruction"], "one per class: the memorandum and the template share the last");

  assert.equal(seeksDecisions("ما الأحكام القضائية في هذا؟"), true);
  assert.equal(seeksDecisions("ما أحكام عقد الإيجار؟"), false, "أحكام العقد are its provisions");
  assert.equal(seeksDecisions("هل يجوز الطعن في القرار الإداري؟"), false);
  assert.equal(seeksMou("مذكرات التفاهم"), true);
});

// ---------------------------------------------------------------- classification and normalisation

test("classification: memoranda, interpretation decisions, pleadings and fee schedules each get their own type", () => {
  assert.equal(classifySource("/d/مذكرة_تفاهم_بين_وزارة_العدل_والأمن_العام.pdf").type, "mou");
  assert.equal(classifySource("/d/مذكرة التفاهم مع نقابة المحامين.pdf").type, "mou");
  assert.equal(classifySource("/d/قرار_الديوان_الخاص_بتفسير_القوانين_رقم_3.txt").type, "interpretation");
  assert.equal(classifySource("/d/لائحة_دعوى_مطالبة_عمالية.docx").type, "template");
  assert.equal(classifySource("/d/لائحة_أجور_أتعاب_الكاتب_العدل_المرخص.pdf").type, "regulation", "a fee schedule is not a pleading template");
  assert.equal(classifySource("/d/قانــــــون_العفو_العام_رقـم_5_لسنـــــــــــــة_2024.pdf").type, "law", "tatweel no longer hides the leading word");
  assert.equal(classifySource("/d/x.pdf", "interpretation").type, "interpretation");
});

test("titles, law numbers and years: normalised for display, read from the title's own words, never invented", () => {
  const raw = "قانــــــون_العفو_العام_رقـم_5_لسنـــــــــــــة_2024";
  assert.equal(normalizeTitle(raw), "قانون العفو العام رقم 5 لسنة 2024");
  assert.equal(normalizeTitle("قانون رقم (٤٦) لسنة ٢٠٢٤"), "قانون رقم 46 لسنة 2024");
  assert.equal(normalizeTitle("نظام التنظيم اإلداري لوزارة العدل"), "نظام التنظيم الإداري لوزارة العدل", "a reversed lam-alef at a word start is repaired");
  assert.equal(normalizeTitle("قانون الاتالف"), "قانون الاتالف", "an ambiguous inversion is left alone");
  assert.equal(parseLawNumber("قانـون العفو العام رقـم 5 لسنـة 2024"), "5");
  assert.equal(parseLawYear("قانـون العفو العام رقـم 5 لسنـــة 2024"), 2024);
  assert.equal(isAmendingTitle("قانـون معـدل لقانون العقوبات"), true);
  assert.deepEqual(titleProblems("قانون الملكية العقارية لسنة أحكام عامة"), ["malformed_citation"]);
  assert.deepEqual(titleProblems("قانون العمل رقم 8 لسنة 1996"), []);
  assert.deepEqual(titleProblems("قانون_العمل"), ["unnormalized"]);
  assert.equal(framedLawYear("قانون العمل رقم 8 لسنة 1996"), 1996);
  assert.equal(framedLawYear("نظام رسوم الكاتب العدل 2026"), null, "a bare year is not the law's year");
  assert.equal(framedLawYear("قانون الملكية العقارية لسنة أحكام عامة"), null);
});

// ---------------------------------------------------------------- the required-law registry

test("required-law registry: every number and year is the one its cited list carries; every benchmark law is registered", () => {
  const laws = loadRegistry(resolve(ROOT, "deploy/sources/required-laws.json"));
  const { findings, evidence } = crossCheckRegistry(laws, loadRegistrySources(resolve(ROOT, "deploy/sources"), resolve(ROOT, "benchmark/legal-qa-100.json")));
  assert.deepEqual(findings.filter((f) => f.severity === "error"), []);
  for (const l of laws) assert.equal(l.evidence, evidence[l.id], `${l.id}: the registry names the record the check finds`);
  // The laws whose number and year rest on a list that calls itself guidance.
  assert.deepEqual(
    findings.filter((f) => f.kind === "guidance_only").map((f) => f.lawId).sort(),
    ["arbitration", "companies", "consumer-protection", "evidence", "income-tax", "labour", "owners-tenants", "personal-status", "real-property", "trade"]
  );
  assert.equal(laws.find((l) => l.id === "constitution")!.basis, "moj-constitution-list");

  // A wrong number, an unknown basis and an unregistered benchmark law are each errors.
  const civil = laws.find((l) => l.id === "civil")!;
  const broken = crossCheckRegistry(
    [{ ...civil, year: 1977 }, { ...civil, id: "x", name: "قانون السير", basis: "memory", evidence: undefined }],
    { mojLawFiles: ["القانون_المدني_رقم_43_لسنة_1976.pdf"], constitutionFiles: [], missingListItems: [], benchmarkLaws: ["قانون الجمارك"] }
  ).findings.map((f) => f.kind);
  assert.deepEqual(broken.sort(), ["basis_mismatch", "basis_unknown", "benchmark_law_unregistered", "evidence_differs"].sort());
});
