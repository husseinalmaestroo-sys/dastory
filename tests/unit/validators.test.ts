import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCaseAnalysis, validateContractReview, validateDraft, extractJson } from "@/lib/ai/output-schemas";
import { verifyCitedNumbers } from "@/lib/ai/guard";
import { chunk, penalChunk } from "./fixtures";

// These feed deliberately BAD model outputs (fabricated parties, quotes,
// figures, citations) straight to the validators — the model cannot be made
// to misbehave on demand offline, so the guards are tested on the outputs a
// misbehaving model would produce.

const caseText = `لائحة دعوى\nالمدعي: سالم التجريبي\nالمدعى عليه: شركة الاختبار\nتأخر المستأجر في دفع الأجرة مدة تزيد على ثلاثين يوما من تاريخ استحقاقها.\nوأنذره المدعي بتاريخ 2099-02-01.`;

test("case analysis: malformed JSON fails safely — no raw text is returned", () => {
  const r = validateCaseAnalysis("هذا ليس JSON بل تحليل حر", caseText, [chunk()]);
  assert.equal(r.ok, false);
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.equal(extractJson("no json here"), null);
});

test("case analysis: an invented party, an unevidenced fact and an article absent from the file are dropped", () => {
  const raw = JSON.stringify({
    summary: "نزاع إيجار",
    parties: [
      { role: "مدعي", name: "سالم التجريبي", excerpt: "المدعي: سالم التجريبي" },
      { role: "أخرى", name: "شاهد مختلق", excerpt: "شاهد مختلق" },
    ],
    facts: [
      { fact: "تأخر المستأجر في دفع الأجرة", excerpt: "تأخر المستأجر في دفع الأجرة مدة تزيد على ثلاثين يوما" },
      { fact: "اعترف المستأجر كتابةً بالدين", excerpt: "اعترف المستأجر كتابة بالدين" },
    ],
    cited_articles: ["المادة 5 من قانون الإيجار", "المادة 99 من قانون العقوبات"],
    legal_basis: [{ point: "يجوز للمؤجر طلب فسخ العقد إذا تأخر المستأجر في التسليم", citation: "[1]" }],
    possible_defenses: [{ defense: "دفع بلا مصدر", citation: "[7]" }],
  });
  const text = caseText + "\nالمادة 5 من قانون الإيجار";
  const r = validateCaseAnalysis(raw, text, [chunk()]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.analysis.parties.map((p) => p.name), ["سالم التجريبي"]);
  assert.equal(r.analysis.facts.length, 1);
  assert.deepEqual(r.analysis.cited_articles, ["المادة 5 من قانون الإيجار"]);
  assert.equal(r.analysis.possible_defenses.length, 0, "an out-of-range citation drops the item");
  assert.equal(r.report.droppedParties, 1);
  assert.equal(r.report.droppedFacts, 1);
});

const contract = `عقد إيجار\nالفريق الأول: شركة الاختبار\nالفريق الثاني: سالم التجريبي\nالبند الثاني: يلتزم المستأجر بغرامة قدرها عشرة دنانير عن كل يوم تأخير.\nالأجرة السنوية 1200 دينار.`;

test("contract review: a fabricated excerpt is blanked, an invented figure redacted, an uncited article redacted", () => {
  const raw = JSON.stringify({
    summary: "عقد إيجار بأجرة 1200 دينار",
    parties: ["شركة الاختبار", "طرف غير موجود"],
    keyTerms: [
      { label: "الأجرة", value: "1200 دينار" },
      { label: "التأمين", value: "5000 دينار" },
    ],
    risks: [
      { severity: "high", title: "غرامة", excerpt: "يلتزم المستأجر بغرامة قدرها عشرة دنانير", explanation: "بند جزائي مرتفع." },
      { severity: "medium", title: "مختلق", excerpt: "يحق للمؤجر الإخلاء دون إنذار", explanation: "وفقاً للمادة 780 من القانون المدني." },
      { severity: "weird", title: "درجة غير معروفة", excerpt: "", explanation: "انظر [9]." },
    ],
  });
  const r = validateContractReview(raw, contract, [chunk()]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.review.parties, ["شركة الاختبار"]);
  assert.equal(r.review.keyTerms[0].value, "1200 دينار");
  assert.ok(!r.review.keyTerms[1].value.includes("5000"));
  assert.equal(r.review.risks[0].excerptVerified, true);
  assert.equal(r.review.risks[1].excerptVerified, false);
  assert.equal(r.review.risks[1].excerpt, "");
  assert.ok(!r.review.risks[1].explanation.includes("780"), "uncited article number redacted");
  assert.equal(r.review.risks[2].severity, "info", "unknown severity coerced, not trusted");
  assert.ok(!r.review.risks[2].explanation.includes("[9]"));
});

test("draft: preamble stripped, invented dates/amounts/ids replaced, uncited article replaced, cited one kept", () => {
  const raw = [
    "إليك المسودة المطلوبة:",
    "# محكمة الصلح الموقرة",
    "## الوقائع",
    "1. بتاريخ 15/03/2099 تأخر المستأجر في دفع مبلغ 900 دينار.",
    "2. الرقم الوطني للمدعى عليه 9981234567.",
    "## الأسانيد القانونية",
    "المادة 12 من قانون الإيجار التجريبي [1].",
    "المادة 780 من القانون المدني.",
  ].join("\n");
  const r = validateDraft(raw, "المدعي سالم، المدعى عليه خالد، تأخر في الأجرة", [chunk()]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.draft.startsWith("# محكمة"));
  assert.ok(!r.draft.includes("15/03/2099") && !r.draft.includes("900 دينار") && !r.draft.includes("9981234567"));
  assert.equal(r.report.unverifiedFacts.length, 3);
  assert.ok(r.draft.includes("المادة 12 من قانون الإيجار التجريبي [1]"));
  assert.ok(!r.draft.includes("780"));
  assert.equal(r.groundingLevel, "partial");
});

test("draft: values the lawyer supplied are kept", () => {
  const r = validateDraft("# لائحة\n## الوقائع\nبتاريخ 15/03/2099 استحق مبلغ 900 دينار.", "تاريخ الاستحقاق 15/03/2099 والمبلغ 900 دينار", [chunk()]);
  assert.ok(r.ok && r.report.unverifiedFacts.length === 0 && r.draft.includes("15/03/2099"));
});

test("draft without a document header fails safely", () => {
  assert.equal(validateDraft("لا أستطيع إعداد المسودة", "", [chunk()]).ok, false);
});

test("a date is not mistaken for a decision number by the citation guard", async () => {
  const { redactCitations } = await import("@/lib/ai/guard");
  assert.equal(redactCitations("بتاريخ 15/03/2099 أقيمت الدعوى").redactedCount, 0);
  assert.equal(redactCitations("وفق القرار 123/2099").redactedCount, 1);
});

test("a cross-reference that appears in the cited source's own text is not redacted", () => {
  const src = chunk({ article_number: "41", chunk_text: "إذا وقع الإتلاف على مال عام تضاعفت العقوبة المنصوص عليها في المادة 40." });
  const r = verifyCitedNumbers("تتضاعف العقوبة المنصوص عليها في المادة 40 إذا وقع الإتلاف على مال عام [1].", [src]);
  assert.equal(r.redactedCount, 0);
  const bad = verifyCitedNumbers("تتضاعف العقوبة المنصوص عليها في المادة 77 [1].", [src, penalChunk()]);
  assert.equal(bad.redactedCount, 1);
});
