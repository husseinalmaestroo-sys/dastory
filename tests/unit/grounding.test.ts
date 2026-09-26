import { test } from "node:test";
import assert from "node:assert/strict";
import { groundAnswer, splitSentences, quoteIsVerbatim, NUMBER_REDACTION, INFERENCE_LABEL, HISTORICAL_LABEL } from "@/lib/ai/grounding";
import { chunk, penalChunk } from "./fixtures";

test("a claim backed by its cited source is fully grounded", () => {
  const r = groundAnswer("الخلاصة: يلتزم المؤجر بتسليم المأجور إلى المستأجر في الموعد المتفق عليه [1].", [chunk()]);
  assert.equal(r.level, "full");
  assert.equal(r.counts.supported, 1);
  assert.equal(r.claims[0].evidence?.ref, 1);
});

test("a fabricated quotation is removed (citation rule 6)", () => {
  const r = groundAnswer('النص القانوني: "يلتزم المستأجر بدفع غرامة يومية قدرها عشرة دنانير" [1].', [chunk()]);
  assert.equal(r.counts.removed, 1);
  assert.deepEqual(r.claims[0].issues, ["fabricated_quote"]);
  assert.equal(r.level, "none");
  assert.ok(!r.text.includes("غرامة يومية"));
});

test("a verbatim quotation (folded orthography, ellipsis) is accepted", () => {
  const src = chunk().chunk_text;
  assert.ok(quoteIsVerbatim("يلتزم المؤجر بتسليم المأجور ... في الموعد المتفق عليه", src));
  assert.ok(quoteIsVerbatim("يلتزم المؤجر بتسليم الماجور", src), "hamza/alef variants fold");
  assert.ok(!quoteIsVerbatim("يلتزم المؤجر بتسليم السيارة", src));
});

test("a figure absent from the cited source is redacted, the claim qualified", () => {
  const r = groundAnswer("يجوز للمستأجر فسخ العقد إذا تأخر المؤجر في التسليم مدة تزيد على 90 يوماً [1].", [chunk()]);
  assert.ok(r.text.includes(NUMBER_REDACTION), r.text);
  assert.ok(!r.text.includes("90"));
  assert.equal(r.claims[0].status, "qualified");
  assert.equal(r.level, "partial");
});

test("a figure present in the cited source (article number, law number, year) is kept", () => {
  const r = groundAnswer("تنص المادة 12 من قانون الإيجار التجريبي رقم 7 لسنة 2099 على التزام المؤجر بتسليم المأجور [1].", [chunk()]);
  assert.equal(r.counts.redactedNumbers, 0, r.text);
  assert.equal(r.level, "full");
});

test("the digits of a [n] marker are never redacted", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور إلى المستأجر في 1 الموعد المتفق عليه [1].", [chunk({ chunk_text: chunk().chunk_text.replace("12", "3") , article_number: "3"})]);
  assert.ok(r.text.includes("[1]"), r.text);
});

test("a legal claim without any citation is removed", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور [1].\n\nأما التعويض فيستحق دائماً.", [chunk()]);
  const removed = r.claims.filter((c) => c.status === "removed");
  assert.equal(removed.length, 1, JSON.stringify(r.claims, null, 1));
  assert.ok(!r.text.includes("يستحق دائماً"));
  assert.equal(r.level, "partial");
});

test("an uncited penalty tacked onto a cited sentence is removed, not passed off as inference", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور [1]. ويعاقب المستأجر المتأخر بالحبس سنة كاملة.", [chunk()]);
  assert.equal(r.claims[1].status, "removed", JSON.stringify(r.claims[1]));
  assert.ok(!r.text.includes("بالحبس"));
});

test("a weakly supported penalty claim is removed even with its own citation", () => {
  const r = groundAnswer("ويعاقب المستأجر المتأخر عن الدفع بالحبس [1].", [chunk()]);
  assert.equal(r.claims[0].status, "removed");
  assert.ok(r.claims[0].issues.includes("weak_support"));
});

test("an uncited sentence right after a cited one inherits its source (carry-forward), and is checked against it", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور في الموعد المتفق عليه [1]. وإذا تأخر المؤجر في التسليم جاز للمستأجر فسخ العقد.", [chunk()]);
  assert.equal(r.counts.removed, 0);
  assert.deepEqual(r.claims[1].refs, [1]);
});

test("naming a different law than the cited source is a law mismatch (removed)", () => {
  const r = groundAnswer("وفقاً لقانون العقوبات التجريبي يلتزم المؤجر بتسليم المأجور [1].", [chunk(), penalChunk()]);
  assert.equal(r.claims[0].status, "removed");
  assert.deepEqual(r.claims[0].issues, ["law_mismatch"]);
});

test("naming the law of the cited source passes", () => {
  const r = groundAnswer("وفقاً لقانون العقوبات التجريبي يعاقب بالحبس كل من أتلف مال غيره عمداً [2].", [chunk(), penalChunk()]);
  assert.equal(r.claims[0].status, "supported", JSON.stringify(r.claims[0]));
});

test("an out-of-range citation is stripped; with no valid source left the claim is removed", () => {
  const r = groundAnswer("يعاقب بالحبس مدة لا تقل عن شهر [9].", [chunk()]);
  assert.equal(r.counts.strippedCitations, 1);
  assert.equal(r.claims[0].status, "removed");
  assert.ok(r.claims[0].issues.includes("invalid_citation"));
});

test("a claim with little overlap with its source loses its citation and is labelled as inference (rule 7)", () => {
  const r = groundAnswer("ويحق للمستأجر المطالبة بتعويض عن الأضرار المعنوية والنفسية الناجمة عن التأخير [1].", [chunk()]);
  assert.equal(r.claims[0].kind, "inference");
  assert.ok(r.text.includes(INFERENCE_LABEL.trim()), r.text);
  assert.ok(!r.text.includes("[1]"), "a citation that does not support the claim is removed");
  assert.equal(r.level, "partial");
});

test("an invented URL is removed; a cited source's recorded URL is kept", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور في الموعد المتفق عليه كما في https://laws.example/fake/123 [1].", [chunk({ source_url: "https://moj.example/lease" })]);
  assert.ok(!r.text.includes("laws.example"));
  assert.ok(r.claims[0].issues.includes("fabricated_url"));
  const ok = groundAnswer("يلتزم المؤجر بتسليم المأجور في الموعد المتفق عليه https://moj.example/lease [1].", [chunk({ source_url: "https://moj.example/lease" })]);
  assert.ok(ok.text.includes("https://moj.example/lease"));
});

test("citing a superseded version without saying so gets the historical label", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور إلى المستأجر في الموعد المتفق عليه [1].", [chunk({ is_current_version: false })]);
  assert.ok(r.text.includes(HISTORICAL_LABEL.trim()), r.text);
  assert.ok(r.claims[0].issues.includes("historical_unlabelled"));
});

test("a superseded version that the answer already labels is left alone", () => {
  const r = groundAnswer("كان النص السابق يلزم المؤجر بتسليم المأجور إلى المستأجر [1].", [chunk({ is_current_version: false })]);
  assert.ok(!r.claims[0].issues.includes("historical_unlabelled"));
});

test("limitation statements are kept and not counted as claims", () => {
  const r = groundAnswer("يلتزم المؤجر بتسليم المأجور [1].\n\nحدود الإجابة: لم تتضمن المصادر المتاحة مدة التقادم.", [chunk()]);
  assert.ok(r.text.includes("لم تتضمن المصادر"));
  assert.equal(r.counts.claims, 1);
  assert.equal(r.level, "full");
});

test("a figure in a limitation sentence must come from the question or the sources", () => {
  const r = groundAnswer("لم أجد في المصادر ما يؤكد أن المادة 55 تفرض غرامة 500 دينار.", [chunk()], { question: "هل تفرض المادة 55 غرامة؟" });
  assert.ok(r.text.includes("55"), "number from the question stays");
  assert.ok(!r.text.includes("500"), "invented figure is redacted");
});

test("the sentence splitter keeps quotations and citation markers intact", () => {
  const parts = splitSentences('تنص المادة على "يلتزم المؤجر. وإذا تأخر جاز الفسخ" [1]. ويجوز ذلك. [2] ثم انتهى');
  assert.equal(parts.length, 3, JSON.stringify(parts));
  assert.ok(parts[0].endsWith("[1]."));
  assert.ok(parts[1].includes("[2]"));
});

test("an answer with only removed claims has grounding level none", () => {
  const r = groundAnswer("يعاقب المؤجر بالسجن عشر سنوات.", [chunk()]);
  assert.equal(r.level, "none");
  assert.equal(r.text, "");
});
