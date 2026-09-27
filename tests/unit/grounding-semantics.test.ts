import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClaimVerdicts, claimsForJudge, CONDITION_LABEL, groundAnswer, NUMBER_REDACTION } from "@/lib/ai/grounding";
import {
  criticalCategories,
  droppedCondition,
  extractPremise,
  isBoilerplateArticle,
  meaningConflicts,
  numberValues,
  polarities,
  premiseConflicts,
  questionTopicStems,
  sourceIsRelevant,
  stripLawNames,
} from "@/lib/ai/legal-semantics";
import { verifyCitedNumbers } from "@/lib/ai/guard";
import { chunk, penalChunk } from "./fixtures";

// Phase 2.1 grounding: the meaning-level failures the held-out adversarial set
// (eval/dataset.json, committed before this code) showed a lexical support
// score cannot see. Synthetic sources only.

const lease = (article: string, text: string) => chunk({ id: 100 + Number(article), article_number: article, chunk_text: text });
const lease6 = lease("6", "المادة 6: لا يجوز للمستأجر أن يؤجر المأجور من الباطن إلا بموافقة المؤجر الخطية.");
const lease12 = lease("12", "المادة 12: يلتزم المؤجر بصيانة المأجور صيانة دورية وإجراء الإصلاحات الضرورية التي يقتضيها حفظه، ويتحمل نفقاتها ما لم يتفق الطرفان كتابةً على غير ذلك.");
const lease1 = lease("1", "المادة 1: يسمى هذا القانون قانون الإيجار التجريبي لسنة 2099 ويعمل به من تاريخ نشره.");
const lease5 = lease("5", "المادة 5: إذا تأخر المستأجر في دفع الأجرة مدة تزيد على ثلاثين يوماً من تاريخ استحقاقها جاز للمؤجر أن يطلب فسخ العقد بعد إنذاره بمدة خمسة عشر يوماً.");
const labour20 = chunk({ id: 220, source_title: "قانون العمل التجريبي رقم 9 لسنة 2099", law_name: "قانون العمل التجريبي", law_number: "9", article_number: "20", chunk_text: "المادة 20: يستحق العامل إجازة سنوية مدفوعة الأجر مدتها واحد وعشرون يوماً عن كل سنة خدمة." });

// ---- guard: a citation marker is never an article number

test("\"في المادة [1]\" keeps its citation marker (the marker is not article 1)", () => {
  const penal41 = penalChunk({ article_number: "41", chunk_text: "المادة 41: إذا وقع الإتلاف على مال عام تضاعفت العقوبة المنصوص عليها في المادة 40." });
  const out = verifyCitedNumbers("إذا وقع الإتلاف على مال عام تضاعفت العقوبة المنصوص عليها في المادة [1].", [penal41]);
  assert.equal(out.redactedCount, 0, out.text);
  assert.ok(out.text.includes("[1]"));
});

test("\"المادة [12]\" with no twelfth source is an article number, checked like any other", () => {
  const penal41 = penalChunk({ article_number: "41", chunk_text: "المادة 41: إذا وقع الإتلاف على مال عام تضاعفت العقوبة المنصوص عليها في المادة 40." });
  const out = verifyCitedNumbers("وتعالج المادة [12] هذه الحالة [1].", [penal41]);
  assert.equal(out.redactedCount, 1, out.text);
  assert.ok(!out.text.includes("12"), out.text);
});

// ---- numbers written as words

test("number words are figures: compounds, teens, hundreds, thousands, duals", () => {
  assert.deepEqual([...numberValues("مدتها واحد وعشرون يوماً")], [21]);
  assert.deepEqual([...numberValues("بمدة خمسة عشر يوماً")], [15]);
  assert.deepEqual([...numberValues("غرامة مائة وخمسون ديناراً")], [150]);
  assert.deepEqual([...numberValues("لا تتجاوز خمسة آلاف دينار")], [5000]);
  assert.deepEqual([...numberValues("بمرور سنتين")], [2]);
  assert.deepEqual([...numberValues("مدته ستون يوماً")], [60]);
});

test("a lone \"أحد\"/\"واحد\" is not the number one", () => {
  assert.equal(numberValues("يجوز لأحد الطرفين إنهاء العقد").size, 0);
  assert.equal(numberValues("كل واحد منهما مسؤول").size, 0);
});

test("a number word the cited source does not contain is redacted; one it contains (as digits or words) is kept", () => {
  const src = chunk({ chunk_text: "المادة 17: يجوز لأي من طرفي عقد العمل غير محدد المدة إنهاؤه بإشعار خطي مدته ثلاثون يوماً." });
  const bad = groundAnswer("يجوز إنهاء عقد العمل غير محدد المدة بإشعار خطي مدته ستون يوماً [1].", [src]);
  assert.ok(bad.text.includes(NUMBER_REDACTION) && !bad.text.includes("ستون"), bad.text);
  assert.equal(bad.claims[0].status, "qualified");
  const good = groundAnswer("يجوز إنهاء عقد العمل غير محدد المدة بإشعار خطي مدته ثلاثين يوماً [1].", [src]);
  assert.equal(good.level, "full", good.text);
  const digits = groundAnswer("يجوز إنهاء عقد العمل غير محدد المدة بإشعار خطي مدته 30 يوماً [1].", [src]);
  assert.equal(digits.level, "full", digits.text);
});

// ---- critical terms and polarity

test("penalty types and mental elements are recognised in their usual forms", () => {
  assert.deepEqual([...criticalCategories("يعاقب بالإعدام")], ["penalty:death"]);
  assert.deepEqual([...criticalCategories("وبغرامة لا تتجاوز مئتي دينار")].sort(), ["penalty:fine"]);
  assert.deepEqual([...criticalCategories("كل من أتلف مال غيره عمداً")], ["mens:intent"]);
  assert.deepEqual([...criticalCategories("إذا وقع الضرر خطأً")], ["mens:negligence"]);
  assert.equal(criticalCategories("خطاب إنذار").size, 0, "خطاب is not خطأ");
  assert.deepEqual([...criticalCategories("يلتزم المستأجر بتعويض المؤجر")], ["remedy:compensation"]);
  assert.deepEqual([...criticalCategories("ويقع العقد باطلاً")], ["remedy:nullity"]);
  assert.equal(criticalCategories("للانتفاع المقصود منه").size, 0, "المقصود is not قصداً");
});

test("polarity: negation particles flip a permission/obligation/penalty verb", () => {
  assert.deepEqual(polarities("لا يجوز للمستأجر").map((p) => [p.family, p.polarity]), [["permit", -1]]);
  assert.deepEqual(polarities("يجوز للمؤجر").map((p) => [p.family, p.polarity]), [["permit", 1]]);
  assert.deepEqual(polarities("ولا يعاقب").map((p) => [p.family, p.polarity]), [["punish", -1]]);
  assert.deepEqual(polarities("يحظر على المستأجر").map((p) => [p.family, p.polarity]), [["permit", -1]]);
});

test("a flipped negation is a contradiction; a correctly restated exception is not", () => {
  assert.deepEqual(meaningConflicts("يجوز للمستأجر أن يؤجر المأجور من الباطن", lease6.chunk_text), [{ kind: "polarity", family: "permit" }]);
  assert.deepEqual(meaningConflicts("يجوز للمستأجر تأجير المأجور من الباطن بموافقة المؤجر الخطية", lease6.chunk_text), []);
  assert.deepEqual(meaningConflicts("يحظر على المستأجر التأجير من الباطن دون موافقة المؤجر", lease6.chunk_text), []);
});

test("grounding removes contradictions: flipped or added negation, swapped penalty, swapped mental element", () => {
  const p40 = penalChunk();
  for (const [claim, src, q] of [
    ["يجوز للمستأجر أن يؤجر المأجور من الباطن [1].", lease6, "هل يجوز للمستأجر التأجير من الباطن؟"],
    ["لا يعاقب من أتلف مال غيره عمداً [1].", p40, "هل يعاقب من أتلف مال غيره عمداً؟"],
    ["يعاقب بالإعدام كل من أتلف مال غيره عمداً [1].", p40, "ما عقوبة إتلاف مال الغير عمداً؟"],
    ["يعاقب بالحبس كل من أتلف مال غيره خطأً [1].", p40, "ما عقوبة إتلاف مال الغير؟"],
    ["ويلتزم المستأجر المتأخر في الدفع بتعويض المؤجر عن كل يوم تأخير [1].", chunk(), "ما التزامات المستأجر عند التأخر؟"],
  ] as const) {
    const r = groundAnswer(claim, [src], { question: q });
    assert.equal(r.claims[0].status, "removed", claim);
    assert.deepEqual(r.claims[0].issues, ["contradiction"], claim);
    assert.equal(r.level, "none", claim);
  }
  // the faithful statement of the same article passes
  const ok = groundAnswer("يعاقب بالحبس مدة لا تقل عن شهر كل من أتلف مال غيره عمداً [1].", [p40], { question: "ما عقوبة إتلاف مال الغير عمداً؟" });
  assert.equal(ok.level, "full", ok.text);
});

// ---- dropped conditions and exceptions

test("a rule stated without its source's condition is labelled, not removed", () => {
  assert.ok(droppedCondition("يلتزم المؤجر بصيانة المأجور ويتحمل نفقاتها", lease12.chunk_text.replace(/^المادة 12: /, "")));
  const r = groundAnswer("يلتزم المؤجر بصيانة المأجور ويتحمل نفقاتها [1].", [lease12], { question: "من يتحمل نفقات صيانة المأجور؟" });
  assert.equal(r.claims[0].status, "qualified");
  assert.ok(r.claims[0].issues.includes("missing_condition"));
  assert.ok(r.text.includes("مع مراعاة الشروط والاستثناءات"), r.text);
  assert.equal(r.level, "partial");
});

test("a claim that carries the condition, or the verbatim sentence, is not labelled", () => {
  const withCondition = groundAnswer("يجوز للمؤجر طلب فسخ العقد إذا تأخر المستأجر في دفع الأجرة أكثر من ثلاثين يوماً [1].", [lease5], { question: "متى يجوز فسخ الإيجار؟" });
  assert.equal(withCondition.level, "full", withCondition.text);
  const without = groundAnswer("يجوز للمؤجر أن يطلب فسخ العقد [1].", [lease5], { question: "متى يجوز فسخ الإيجار؟" });
  assert.ok(without.text.includes(CONDITION_LABEL.trim().slice(1, 12)), without.text);
  const quote = groundAnswer(`النص القانوني: "${lease12.chunk_text.replace(/^المادة 12: /, "")}" [1].`, [lease12], { question: "من يتحمل نفقات صيانة المأجور؟" });
  assert.equal(quote.level, "full", quote.text);
});

// ---- relevance to the question

test("the law named in the question is not subject matter; a short-title article is boilerplate", () => {
  assert.equal(stripLawNames("ما عقوبة إتلاف مال الغير عمداً في قانون العقوبات التجريبي؟").includes("العقوبات التجريبي"), false);
  assert.ok(questionTopicStems("ما عقوبة إتلاف مال الغير عمداً في قانون العقوبات التجريبي؟").length >= 3);
  assert.equal(questionTopicStems("ما نص المادة 17 من قانون العمل التجريبي؟").length, 0, "a pure lookup has no subject words");
  assert.ok(isBoilerplateArticle(lease1.chunk_text));
  assert.ok(!isBoilerplateArticle(lease5.chunk_text));
});

test("relevance: boilerplate and off-topic sources are irrelevant; topical, lookup and exact-hit sources are relevant", () => {
  assert.equal(sourceIsRelevant("متى يجوز للمؤجر طلب فسخ عقد الإيجار؟", lease1), false);
  assert.equal(sourceIsRelevant("متى يعمل بقانون الإيجار التجريبي؟", lease1), true, "a question about commencement");
  assert.equal(sourceIsRelevant("ما عقوبة إتلاف مال الغير في قانون العقوبات التجريبي؟", penalChunk({ article_number: "1", chunk_text: "المادة 1: يسمى هذا القانون قانون العقوبات التجريبي لسنة 2099." })), false);
  assert.equal(sourceIsRelevant("ما عقوبة إتلاف مال الغير في قانون العقوبات التجريبي؟", penalChunk()), true);
  assert.equal(sourceIsRelevant("ما أحكام الإيجار؟", lease5), true, "without a named law, the law's own name counts");
  assert.equal(sourceIsRelevant("ما نص المادة 12 من قانون الإيجار التجريبي؟", lease12), true, "pure lookup");
  assert.equal(sourceIsRelevant("ما هي شروط تسجيل براءة الاختراع؟", lease5), false);
  assert.equal(sourceIsRelevant("ما هي شروط تسجيل براءة الاختراع؟", lease5, { exactHit: true }), true);
});

test("grounding removes a claim whose only source does not bear on the question", () => {
  const r = groundAnswer("يسمى هذا القانون قانون الإيجار التجريبي لسنة 2099 [1].", [lease1], { question: "متى يجوز للمؤجر طلب فسخ عقد الإيجار؟" });
  assert.deepEqual(r.claims[0].issues, ["irrelevant_source"]);
  assert.equal(r.level, "none");
  // without a question (document validators) relevance is not judged
  assert.equal(groundAnswer("يسمى هذا القانون قانون الإيجار التجريبي لسنة 2099 [1].", [lease1]).level, "full");
});

// ---- premises

test("premises: what a question asserts about an article is checked against it", () => {
  const p6 = extractPremise("بما أن المادة 20 من قانون العمل التجريبي تمنح العامل إجازة سنوية مدتها ستون يوماً، فكيف تحتسب هذه الإجازة؟");
  assert.ok(p6 && p6.includes("ستون"), String(p6));
  assert.deepEqual(premiseConflicts(p6!, labour20.chunk_text, new Set([20, 9, 2099])), [{ kind: "number", value: 60 }]);

  const p7 = extractPremise("لماذا تعاقب المادة 55 من قانون العقوبات التجريبي على التهديد بالإعدام؟");
  const penal55 = penalChunk({ article_number: "55", chunk_text: "المادة 55: يعاقب بالحبس مدة لا تزيد على ستة أشهر كل من هدد غيره بإيذائه." });
  assert.deepEqual(premiseConflicts(p7!, penal55.chunk_text, new Set([55, 3, 2099])), [{ kind: "critical_term", category: "penalty:death" }]);

  const p8 = extractPremise("بما أن المادة 17 من قانون العمل التجريبي تجيز إنهاء العقد غير محدد المدة بإشعار مدته ثلاثون يوماً، فهل يجب أن يكون الإشعار خطياً؟");
  const labour17 = "المادة 17: يجوز لأي من طرفي عقد العمل غير محدد المدة إنهاؤه بإشعار خطي مدته ثلاثون يوماً.";
  assert.deepEqual(premiseConflicts(p8!, labour17, new Set([17, 9, 2099])), [], "a true premise raises nothing");

  assert.equal(extractPremise("ما مدة الإشعار لإنهاء عقد العمل؟"), null);
});

// ---- semantic verdicts

test("judge verdicts: contradicted/unsupported/irrelevant claims are removed, partial ones labelled", () => {
  const src = chunk();
  const r = groundAnswer(
    "يلتزم المؤجر بتسليم المأجور إلى المستأجر في الموعد المتفق عليه [1]. وإذا تأخر المؤجر في التسليم مدة تزيد على ثلاثين يوماً جاز للمستأجر فسخ العقد [1].",
    [src]
  );
  assert.equal(r.level, "full");
  const judged = claimsForJudge(r);
  assert.equal(judged.length, 2);

  const partial = applyClaimVerdicts(r, new Map([[judged[1].index, "PARTIAL"]]));
  assert.equal(partial.level, "partial");
  assert.ok(partial.text.includes("مع مراعاة الشروط والاستثناءات"));

  const contradicted = applyClaimVerdicts(r, new Map([[judged[0].index, "CONTRADICTED"]]));
  assert.ok(!contradicted.text.includes("بتسليم المأجور إلى المستأجر"));
  assert.ok(contradicted.claims[judged[0].index].issues.includes("semantic_contradiction"));

  const none = applyClaimVerdicts(r, new Map([[judged[0].index, "UNSUPPORTED"], [judged[1].index, "IRRELEVANT"]]));
  assert.equal(none.level, "none");
  assert.equal(none.text, "");
});
