/**
 * Exercises the pure text pipeline — clean → chunk → intent parse → metadata.
 * No DB, no API key: this is the logic that decides retrieval quality, and it
 * is testable in isolation, so it should be.
 *
 *   npx tsx scripts/verify-pipeline.ts
 */
import { cleanText, foldForSearch, normalizeDigits } from "../src/lib/ingest/clean";
import { chunkLegalText, extractKeywords } from "../src/lib/ingest/chunk";
import { extractLegalTopics } from "../src/lib/ingest/legal-topics";
import { parseIntent } from "../src/lib/search/intent";
import { extractDecisionMeta, extractLawName } from "../src/lib/ingest/metadata";
import { titleFromPath, titleScore, pickBestTitled } from "../src/lib/ingest/title";
import { assessArabicText } from "../src/lib/ingest/quality";
import { classifySource } from "../src/lib/ingest/classify";
import { isAmendingTitle, parseLawNumber, parseLawYear, baseLawName } from "../src/lib/ingest/law-identity";
import { validateSourceMetadata } from "../src/lib/ingest/validate";
import { resolveVersionScope } from "../src/lib/search/intent";
import { analyzeQueryRules } from "../src/lib/search/query-understanding";
import { expandWithOntology, LEGAL_ONTOLOGY } from "../src/lib/search/legal-ontology";
import { toOrTsQuery } from "../src/lib/search/query-expansion";
import { resolveThresholds, gateChunk, computeConfidence } from "../src/lib/search/confidence";
import { extractHtmlText, extractHtmlTitle } from "../src/lib/ingest/html";
import { sslFor, poolConfig } from "../src/lib/pg-ssl";
import { estimateCost, isPriced } from "../src/lib/ai/pricing";
import { scanForCitations, redactCitations, verifyCitedNumbers, REDACTION, type CitableChunk } from "../src/lib/ai/guard";
import {
  isRefusal,
  buildDirectSourceAnswer,
  buildStrongGroundingPrompt,
  formatSourcesHighlighted,
  NO_BASIS_ANSWER,
  EXHAUSTED_FALLBACK_ANSWER,
} from "../src/lib/ai/prompts";
import { getCachedEmbedding, setCachedEmbedding } from "../src/lib/search/embedding-cache";
import { computeSeverity, decideAction, extractCitedIndices, type VerificationIssue } from "../src/lib/ai/self-verify";
import { fieldsOf, formatFields, hasSubstantialNotes } from "../src/lib/drafting/forms";
import { sectionHeadingFor, moveSection, blocksToDraft, type DraftBlock } from "../src/lib/drafting/parse";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        got:`, detail);
  }
}

// ---------------------------------------------------------------- clean
console.log("\n[clean]");
{
  const raw = "المادّةُ  ٢٠٢ :  يُلزَم\nكل من سبّب ضرراً للغير\n\nصفحة 3 من 40\n\n- 12 -";
  const out = cleanText(raw);

  check("converts Arabic-Indic digits", out.includes("202"), out);
  check("strips diacritics", !/[ًٌٍَُِّْ]/.test(out), out);
  check("drops page furniture", !out.includes("صفحة 3 من 40") && !out.includes("- 12 -"), out);
  check("rejoins soft-wrapped prose", /يلزم كل من سبب/.test(out), out);
  check("normalizeDigits standalone", normalizeDigits("١٩٨٨") === "1988");
}

// ---------------------------------------------------------------- folding
console.log("\n[fold]");
{
  check("folds hamza forms", foldForSearch("إجراءات") === foldForSearch("اجراءات"));
  check("folds alef maqsura", foldForSearch("على") === foldForSearch("علي"));
  check("folds ta marbuta", foldForSearch("مادة") === foldForSearch("ماده"));
  check("folding is lossy but stable", foldForSearch("المادة") === foldForSearch("الماده"));
}

// ---------------------------------------------------------------- chunk
console.log("\n[chunk]");
{
  const law = `
قانون العمل الأردني رقم 8 لسنة 1996

المادة 1 : يسمى هذا القانون قانون العمل ويعمل به من تاريخ نشره في الجريدة الرسمية.

المادة 2 : يكون للكلمات التالية المعاني المخصصة لها أدناه ما لم تدل القرينة على غير ذلك.
العامل هو كل شخص طبيعي يؤدي عملاً لقاء أجر ويكون تابعاً لصاحب العمل وتحت إمرته.

المادة 3 : أحكام هذا القانون تسري على جميع العمال وأصحاب العمل باستثناء موظفي الحكومة.
`.trim();

  const chunks = chunkLegalText(cleanText(law), { sourceType: "law" });

  check("splits on article boundaries", chunks.length === 3, chunks.length);
  check(
    "stamps each chunk with its article number",
    JSON.stringify(chunks.map((c) => c.articleNumber)) === JSON.stringify(["1", "2", "3"]),
    chunks.map((c) => c.articleNumber)
  );
  check("article 2 keeps its definition body", chunks[1]?.text.includes("لقاء أجر"), chunks[1]?.text);
  check("no chunk is empty", chunks.every((c) => c.text.trim().length > 0));
}

{
  // Long article must split but keep its citation on every piece.
  const long = `المادة 99 : ${"يلتزم المتعهد بتنفيذ الأعمال وفق الأصول الفنية المرعية. ".repeat(120)}`;
  const chunks = chunkLegalText(cleanText(long), { sourceType: "law" });

  check("oversized article is split", chunks.length > 1, chunks.length);
  check(
    "every piece of a split article keeps the article number",
    chunks.every((c) => c.articleNumber === "99"),
    chunks.map((c) => c.articleNumber)
  );
  check("no chunk wildly exceeds the cap", chunks.every((c) => c.text.length <= 2000), chunks.map((c) => c.text.length));
}

{
  // Prose with no article structure: falls back to windowing, never returns [].
  const decision = `
محكمة التمييز بصفتها الحقوقية
القرار رقم 1234/2020

الوقائع :
تتلخص وقائع هذه الدعوى في أن المدعي أقام دعواه بتاريخ 2019/5/1 يطالب فيها بالتعويض عن الضرر.

الأسباب :
وحيث أن المحكمة تجد أن الضرر ثابت ومحقق وأن علاقة السببية قائمة بين الفعل والضرر.

لهذه الأسباب :
تقرر المحكمة رد الطعن وتأييد القرار المميز.
`.trim();

  const chunks = chunkLegalText(cleanText(decision), { sourceType: "court_decision" });
  check("decision splits on its section headers", chunks.length > 1, chunks.length);
  check("ruling section survives intact", chunks.some((c) => c.text.includes("رد الطعن")), chunks.length);
}

{
  check("short input never yields empty chunks", chunkLegalText("نص قصير جداً هنا لا يكفي").length >= 0);
  check("empty input yields no chunks", chunkLegalText("").length === 0);
}

// ---------------------------------------------------------------- structure
console.log("\n[chunk: structural context باب/فصل/فرع]");
{
  const law = `
الباب الأول
أحكام عامة

الفصل الأول
التعريفات

المادة 1 : يسمى هذا القانون قانون العقوبات ويعمل به من تاريخ نشره.

المادة 2 : تسري أحكام هذا القانون على كل من ارتكب في المملكة جريمة.

الباب الثاني
الجرائم الواقعة على الأموال

الفصل الأول
السرقة

المادة 399 : يعد سارقاً كل من أخذ مالاً منقولاً مملوكاً لغيره دون رضاه.
`.trim();

  const chunks = chunkLegalText(cleanText(law), { sourceType: "law" });
  const a1 = chunks.find((c) => c.articleNumber === "1");
  const a2 = chunks.find((c) => c.articleNumber === "2");
  const a399 = chunks.find((c) => c.articleNumber === "399");

  check("article 1 gets its part", a1?.part?.includes("الباب الأول") === true, a1?.part);
  check("article 1 folds the part title", a1?.part?.includes("أحكام عامة") === true, a1?.part);
  check("article 1 gets its chapter", a1?.chapter?.includes("الفصل الأول") === true, a1?.chapter);
  check("article 1 chapter title folded", a1?.chapter?.includes("التعريفات") === true, a1?.chapter);
  check("article 2 shares article 1's part/chapter", a2?.part === a1?.part && a2?.chapter === a1?.chapter, {
    p: a2?.part,
    c: a2?.chapter,
  });
  check("article 399 moves to الباب الثاني", a399?.part?.includes("الباب الثاني") === true, a399?.part);
  check("article 399 part title updated", a399?.part?.includes("الأموال") === true, a399?.part);
  check("new part reset the chapter, then set السرقة", a399?.chapter?.includes("السرقة") === true, a399?.chapter);
  check("article 399 does not keep التعريفات chapter", !a399?.chapter?.includes("التعريفات"), a399?.chapter);

  // Prose that opens with a structural word must NOT be read as a heading.
  const prose = "المادة 5 : الفصل الأول من العقد يعتبر باطلاً إذا خالف النظام العام.";
  const pc = chunkLegalText(cleanText(prose), { sourceType: "law" });
  check("structural word inside article prose is not a heading", pc[0]?.chapter === null, pc[0]?.chapter);
  check("that article still parses its number", pc[0]?.articleNumber === "5", pc[0]?.articleNumber);
}

{
  // A long article keeps BOTH its number and its structural context on every
  // split piece — the context must not be lost mid-article.
  const long = `
الباب الثالث
الالتزامات

الفصل الثاني
آثار العقد

المادة 202 : ${"يلتزم المتعهد بتنفيذ الأعمال وفق الأصول الفنية المرعية وبما يتفق مع مقتضيات حسن النية. ".repeat(60)}
`.trim();

  const chunks = chunkLegalText(cleanText(long), { sourceType: "law" });
  check("long article is split", chunks.length > 1, chunks.length);
  check("every piece keeps article 202", chunks.every((c) => c.articleNumber === "202"), chunks.map((c) => c.articleNumber));
  check(
    "every piece keeps الباب الثالث",
    chunks.every((c) => c.part?.includes("الباب الثالث")),
    chunks.map((c) => c.part)
  );
  check(
    "every piece keeps الفصل الثاني",
    chunks.every((c) => c.chapter?.includes("الفصل الثاني")),
    chunks.map((c) => c.chapter)
  );
}

// ---------------------------------------------------------------- decision sections
console.log("\n[chunk: court decision sections + principle link]");
{
  const decision = `
محكمة التمييز بصفتها الحقوقية
القرار رقم 1234/2020

المبدأ :
لا تعويض عن ضرر غير محقق، والضرر المستقبلي المؤكد يُعوَّض عنه.

الوقائع :
تتلخص وقائع هذه الدعوى في أن المدعي طالب بالتعويض عن الضرر الذي لحق به.

الأسباب :
وحيث أن المحكمة تجد أن الضرر ثابت ومحقق وأن علاقة السببية قائمة بين الفعل والضرر فإن التعويض مستحق.

لهذه الأسباب :
تقرر المحكمة قبول الطعن ونقض القرار المميز.
`.trim();

  const chunks = chunkLegalText(cleanText(decision), { sourceType: "court_decision" });
  const principle = chunks.find((c) => c.decisionSection === "المبدأ");
  const reasoning = chunks.find((c) => c.decisionSection === "الأسباب");
  const ruling = chunks.find((c) => c.decisionSection === "المنطوق");
  const facts = chunks.find((c) => c.decisionSection === "الوقائع");

  check("tags the principle section", !!principle, chunks.map((c) => c.decisionSection));
  check("tags the facts section", !!facts, chunks.map((c) => c.decisionSection));
  check("tags the reasoning section", !!reasoning, chunks.map((c) => c.decisionSection));
  check("لهذه الأسباب is المنطوق, not الأسباب", ruling?.text.includes("نقض القرار") === true, ruling?.text);
  check(
    "principle is linked to the reasoning that proves it",
    principle?.provesChunkIndex === chunks.indexOf(reasoning!),
    { proves: principle?.provesChunkIndex, reasoningAt: chunks.indexOf(reasoning!) }
  );
  check("non-principle chunk has no proves link", reasoning?.provesChunkIndex === null, reasoning?.provesChunkIndex);
  const legis = chunkLegalText(cleanText("المادة 1 : يسمى هذا القانون قانون العمل ويعمل به من تاريخ نشره في الجريدة الرسمية."), { sourceType: "law" });
  check("legislation chunk has null decisionSection", legis[0]?.decisionSection === null, legis[0]?.decisionSection);
}

// ---------------------------------------------------------------- legal topics
console.log("\n[legal topics]");
{
  const t1 = extractLegalTopics("يلتزم المتعهد بتنفيذ العقد وإلا كان مسؤولاً عن التعويض عن الضرر.");
  check("tags contract + liability topics", t1.includes("التزامات وعقود") && t1.includes("مسؤولية مدنية"), t1);

  const t2 = extractLegalTopics("يعاقب بالحبس كل من ارتكب جريمة السرقة أو الاحتيال أو إساءة الأمانة.");
  check("tags criminal topic", t2.includes("جزائي"), t2);

  const t3 = extractLegalTopics("يصدر الشيك بدون رصيد وتترتب المسؤولية على الأوراق التجارية.");
  check("tags commercial topic", t3.includes("تجاري"), t3);

  const t4 = extractLegalTopics("تُحسب مكافأة نهاية الخدمة للعامل على أساس آخر أجر تقاضاه.");
  check("tags labor topic", t4.includes("عمل"), t4);

  const t5 = extractLegalTopics("نص عام لا يحمل أي مصطلح قانوني متخصص على الإطلاق هنا فقط.");
  check("untagged prose returns no false topics", t5.length === 0, t5);

  // Folding: a query variant must still hit the trigger.
  const t6 = extractLegalTopics("الاجراءات المتعلقة بالدعوى والطعن امام محكمة الاستئناف.");
  check("folded variant still tags procedure", t6.includes("أصول محاكمات"), t6);
}

// ---------------------------------------------------------------- keywords
console.log("\n[keywords]");
{
  const kw = extractKeywords("التعويض عن الضرر والتعويض عن الفقد. الضرر المادي والضرر الأدبي في التعويض.");
  check("extracts repeated legal terms", kw.length > 0, kw);
  check("excludes stopwords", !kw.some((w) => ["في", "عن", "من"].includes(w)), kw);
}

// ---------------------------------------------------------------- intent
console.log("\n[intent]");
{
  const a = parseIntent("ما نص المادة 202 من القانون المدني؟");
  check("finds article number", a.articleNumbers.includes("202"), a.articleNumbers);
  check("flags as lookup", a.isLookup === true);

  const b = parseIntent("أريد قرار التمييز رقم 1234/2020 في قضية حقوقية");
  check("finds decision number", b.decisionNumbers.includes("1234/2020"), b.decisionNumbers);
  check("detects court", b.court === "محكمة التمييز", b.court);
  check("detects category", b.category === "حقوقية", b.category);

  const c = parseIntent("ما شروط فسخ عقد المقاولة؟");
  check("concept question is not a lookup", c.isLookup === false);
  check("concept question has no false article match", c.articleNumbers.length === 0, c.articleNumbers);

  const d = parseIntent("قرارات محكمة الاستئناف لسنة 2019");
  check("year only when framed as a year", d.year === 2019, d.year);

  const e = parseIntent("قانون رقم 8 لسنة 1996 عن العمل");
  check("law number is not mistaken for an article", e.articleNumbers.length === 0, e.articleNumbers);

  const f = parseIntent("ما هي المادة ٢٠٢؟");
  check("handles Arabic-Indic digits in query", f.articleNumbers.includes("202"), f.articleNumbers);
}

// ---------------------------------------------------------------- metadata
console.log("\n[metadata]");
{
  const text = cleanText(`
محكمة التمييز بصفتها الحقوقية
القرار رقم 1234/2020
لسنة 2020

المبدأ القانوني : لا تعويض بلا ضرر محقق وثابت.

الوقائع : ...
`);
  const m = extractDecisionMeta(text);
  check("parses decision number", m.decisionNumber === "1234/2020", m.decisionNumber);
  check("parses court", m.court === "محكمة التمييز", m.court);
  check("parses year", m.year === 2020, m.year);
  check("parses legal principle", !!m.legalPrinciple?.includes("لا تعويض بلا ضرر"), m.legalPrinciple);

  const none = extractDecisionMeta("نص عادي بلا أي ترويسة قرار.");
  check("returns null rather than guessing", none.decisionNumber === null && none.court === null, none);

  const lawName = extractLawName(cleanText("قانون العمل الأردني رقم 8 لسنة 1996\nالمادة 1 : ..."), "احتياطي");
  check("extracts law name", lawName.includes("قانون") && lawName.includes("العمل"), lawName);
  check("falls back to the given title", extractLawName("نص بلا اسم قانون", "عنوان احتياطي") === "عنوان احتياطي");
}

// ---------------------------------------------------------------- quality
console.log("\n[quality: mojibake detection]");
{
  // Mirrors MIN_DISTINCT_COMMON_WORDS in quality.ts — asserts that the partial
  // corruption case really does clear the vocabulary bar, which is the whole
  // reason a second signal was needed.
  const MIN_COMMON_FOR_TEST = 5;
  // Verbatim from the real thing: pdf-parse's output for
  // معدل_لقانون_الكاتب_العدل.pdf (moj.gov.jo). Renders fine in a viewer; the
  // font's ToUnicode map is broken, so the text layer is a substitution cipher.
  // Ground truth of the first line is "المادة 1 - يسمى هذا القانون".
  const GARBLED = `
لبْٔٛ علُ (4248
لبْٔٛ ِعضي ٌمبْٔٛ اٌىبرت اٌعضي
اٌّبصح 3 - ٠ـّٝ ٘ظا اٌمابْٔٛ (لابْٔٛ ِعاضي ٌمابْٔٛ اٌىبرات اٌعاضي ٌـإخ 4248 )
٠ٚمااغا ِاار اٌماابْٔٛ علااُ ( 33 ) ٌـاإخ 3974 اٌّشاابع ئ١ٌااٗ ـ١ّااب ٠ٍااٟ
ثبٌماابْٔٛ اصطااٍٟ ِٚااب ؽااغا ع١ٍااٗ ِاآ رعااض٠ً لبٔٛٔااب ٚادااضا ٠ٚعّااً ثااٗ
ثعض ِغٚع ثلاث١ٓ ٠ِٛب ِٓ ربع٠ز ٔشاغٖ ـاٟ اٌذغ٠اضح اٌغؾا١ّخ ٚعٍاٝ إٌذاٛ
اٌزبٌٟ ٠ٚعزجغ ٘ظا اٌمبْٔٛ ٔبـظا ِٓ ربع٠ز ٔشغٖ ـٟ اٌذغ٠ضح اٌغؾ١ّخ
`.repeat(3);

  const g = assessArabicText(GARBLED);
  check("flags real Gazette mojibake as garbled", g.garbled === true, g);
  check("mojibake covers almost no distinct words", g.distinctCommonWords <= 3, g.distinctCommonWords);
  check("gives a reason a human can act on", !!g.reason?.includes("font encoding"), g.reason);

  // Intact Arabic legal prose.
  const GOOD = `
المادة 1 : يسمى هذا القانون قانون العمل ويعمل به من تاريخ نشره في الجريدة الرسمية.
المادة 2 : يكون للكلمات التالية المعاني المخصصة لها أدناه ما لم تدل القرينة على غير ذلك.
العامل هو كل شخص طبيعي يؤدي عملاً لقاء أجر ويكون تابعاً لصاحب العمل وتحت إمرته.
المادة 3 : تسري أحكام هذا القانون على جميع العمال وأصحاب العمل في المملكة باستثناء
موظفي الحكومة الذين تسري عليهم أحكام نظام الخدمة المدنية المعمول به.
`.repeat(3);

  const ok = assessArabicText(GOOD);
  check("does not flag intact Arabic", ok.garbled === false, ok);
  check("intact Arabic covers many distinct words", ok.distinctCommonWords >= 10, ok.distinctCommonWords);

  check(
    "clear separation between intact and garbled",
    ok.distinctCommonWords > g.distinctCommonWords * 3,
    `good=${ok.distinctCommonWords} garbled=${g.distinctCommonWords}`
  );

  /**
   * Regression: the first detector scored hits-per-1000-chars and wrongly
   * flagged this file — قانون معدل لقانون أصول المحاكمات المدنية رقم 6 لسنة
   * 2024, 2 pages, text perfectly clean — because short formal documents have
   * a low *density* of function words regardless of encoding. It scored 3.8
   * against a threshold of 4, and would have had its (correct) article numbers
   * withheld. Verbatim preamble from the real PDF, tatweel and all.
   */
  const SHORT_CLEAN = `
بنــــاء علــــى ما قـــرره مجلســــــا الاعيــان والنـــــــــــــــواب
نصــادق علـــى القانــون الآتــــي ونأمــــــر باصــــــــــــــــــــداره
واضافتــــه الى قوانيــــن الدولـــــــــــة :-
قانون رقم (6) لسنة 2024
قانون معدل لقانون أصول المحاكمات المدنية
المادة 1 - يسمى هذا القانون (قانون معدل لقانون أصول المحاكمات المدنية لسنة 2024)
ويقرأ مع القانون رقم (24) لسنة 1988 المشار إليه فيما يلي بالقانون الأصلي قانونا واحدا
ويعمل به من تاريخ نشره في الجريدة الرسمية.
`;
  const short = assessArabicText(SHORT_CLEAN);
  check("does not flag a short but clean amending law", short.garbled === false, short);
  check("tatweel-stretched words still count", short.distinctCommonWords >= 5, short.distinctCommonWords);

  // English is not garbled Arabic — it is simply not Arabic, and OCR'ing it
  // would waste minutes for nothing.
  const EN = "Article(1) This law is called the Amendment to the Penal Code for the year 2022 and shall be read with Law No. 16 of 1960 referred to below as the original law.".repeat(4);
  check("does not flag English as garbled", assessArabicText(EN).garbled === false);

  check("short Arabic is not judged", assessArabicText("المادة 5 نص قصير.").garbled === false);
  check("empty text is not judged", assessArabicText("").garbled === false);
  check("diacritics do not hide common words", assessArabicText(GOOD.replace(/في/g, "فِي")).garbled === false);

  /**
   * PARTIAL corruption — the class that slipped through for months.
   *
   * Verbatim from the indexed text of قانون العقوبات (source 3) and القانون
   * المدني (source 2), both from moj.gov.jo, both ingested with a clean bill of
   * health by the vocabulary check alone: the common words survive, so the
   * only tell is that the text between them is shredded into loose letters.
   */
  // Modelled on the real file: intact passages (which is why the vocabulary
  // check passes it) sitting beside shredded ones. The corrupted half is
  // verbatim from source 3's indexed text.
  const PARTIAL_UQUBAT = `
تسري احكام هذا القانون على كل من ارتكب في المملكة جريمة من الجرائم المنصوص عليها فيه، وهي التي
تقع بعد نفاذه، ولا يكون له اثر على ما وقع قبل ذلك من الافعال التي نص عليها القانون.
الباب افول - القانون الجزائ عقوبة و تدبير لم ينص القانون ع يهما حمين اقتمراف الجريممة ، ف جريمة
إف بنص وف يقضه بأ عال تنفيلاا دون النلر اله وقت حصول النتيجة وتعتبر الجريمة تامة الا تمت .
المادة ( 4 ) حق المالحقة الباب افول ولعائ تمه وضميو ه وددممه و ه ممنهم وان لمم يكمن مسمكونا
بالفعمل وقمت ارتكاب الجريمة ، وتنمل ايضا توابعه وم حقاته المتص ة الت يضمها معه سور واحد .
`.repeat(2);
  const partial = assessArabicText(PARTIAL_UQUBAT);
  check("flags PARTIAL corruption (real العقوبات text)", partial.garbled === true, partial);
  check(
    "partial corruption clears the vocabulary bar — hence the second signal",
    partial.distinctCommonWords >= MIN_COMMON_FOR_TEST,
    partial.distinctCommonWords
  );
  check("reports the orphan-letter reason, not the vocabulary one", !!partial.reason?.includes("orphaned"), partial.reason);

  // The other half: clean Arabic must still pass. Legal clause markers
  // (أ- ب- ج-) tokenise as orphans, so this is the case the threshold has to
  // tolerate — it is why clean files sit at 2-4% rather than 0.
  const CLAUSE_MARKERS = `
المادة 4 يتم تأسيس الشركة في المملكة وتسجيلها فيها بمقتضى هذا القانون وتعتبر كل شركة بعد تأسيسها
وتسجيلها على ذلك الوجه شخصا اعتباريا اردني الجنسية ويكون مركزها الرئيسي في المملكة.
المادة 5 أ- تعتبر الشركة قائمة من تاريخ تسجيلها لدى المراقب.
ب- لا يجوز لأي شركة أن تباشر أعمالها قبل التسجيل وفق أحكام هذا القانون.
ج- يترتب على المخالفة الغرامة المنصوص عليها في هذا القانون على أن تدفع خلال المدة المقررة.
د- تسري هذه الأحكام على جميع الشركات المسجلة في المملكة مع مراعاة ما ورد في المادة السابقة.
`.repeat(3);
  const clauses = assessArabicText(CLAUSE_MARKERS);
  check("clean text with أ/ب/ج clause markers is NOT flagged", clauses.garbled === false, clauses);
  check("clause markers keep the orphan ratio under the threshold", clauses.orphanLetterRatio < 0.05, clauses.orphanLetterRatio);
  check("clean lob-sourced prose has a low orphan ratio", assessArabicText(GOOD).orphanLetterRatio < 0.05, assessArabicText(GOOD).orphanLetterRatio);
}

// ---------------------------------------------------------------- titles
console.log("\n[titles]");
{
  check("cleans separators out of a filename", titleFromPath("/x/qarar_1234-2020.pdf") === "qarar 1234 2020");
  check("drops the extension", !titleFromPath("/x/qanun.pdf").includes(".pdf"));

  // The case that actually bit during bulk-ingest testing: identical bytes,
  // and directory order handed the win to the junk name.
  const group = [{ title: "DUPLICATE copy" }, { title: "qarar 1234 2020" }];
  check("prefers a real name over a copy marker", pickBestTitled(group).title === "qarar 1234 2020");
  check("choice does not depend on input order", pickBestTitled([...group].reverse()).title === "qarar 1234 2020");

  check("penalises copy markers", titleScore("qarar 1234 - Copy") > titleScore("qarar 1234"));
  check("penalises Arabic copy marker", titleScore("قرار 1234 نسخة") > titleScore("قرار 1234"));
  check("penalises Windows (1) suffix", titleScore("qarar 1234 (1)") > titleScore("qarar 1234"));
  check("penalises scanner placeholders", titleScore("scan0007") > titleScore("qarar 1234 2020"));
  check("prefers names carrying a number", titleScore("qarar 1234 2020") < titleScore("final version"));
  check(
    "prefers the longer of two equally clean names",
    titleScore("qarar tamyeez 1234 2020 haqooq") < titleScore("qarar 1234")
  );
  check("scoring is pure", (() => {
    const g = [{ title: "b copy" }, { title: "a 1234" }];
    pickBestTitled(g);
    return g[0].title === "b copy"; // input untouched
  })());
}

// ---------------------------------------------------------------- guard
console.log("\n[guard: fabricated citations in ungrounded answers]");
{
  /**
   * This is the load-bearing test in the file.
   *
   * The ungrounded path answers from the model's general knowledge, where any
   * article number it writes is generated rather than retrieved — i.e. a
   * fabricated citation a lawyer might sign their name under. The prompt asks
   * it not to; this guard is what actually stops it. A miss here puts a wrong
   * article number in front of a lawyer as fact.
   */
  const mustCatch: [string, string][] = [
    ["plain article", "المادة 780 من القانون المدني تنص على ما يلي."],
    ["definite article", "تنص المادة 202 على أن الضرر يجب أن يكون محققاً."],
    ["parenthesised", "المادة (5) من القانون الأصلي."],
    ["bracketed", "المادة [12] تعالج هذه الحالة."],
    ["ta-marbuta variant", "الماده 99 من النظام."],
    ["abbreviated", "راجع م. 45 من القانون."],
    ["Arabic-Indic digits", "المادة ٧٨٠ من القانون المدني."],
    ["decision number", "قرار محكمة التمييز رقم 1234/2020 قضى بذلك."],
    ["bare decision ref", "استقر الاجتهاد في 5678/2019 على هذا المبدأ."],
    ["law by number", "قانون العمل رقم 8 لسنة 1996 ينظم هذه المسألة."],
    ["regulation by number", "نظام رقم 46 لسنة 2022 يعالج البدائل."],
  ];

  for (const [label, text] of mustCatch) {
    const scan = scanForCitations(text);
    check(`catches ${label}`, scan.clean === false, `${label}: ${JSON.stringify(scan.found)}`);
    const r = redactCitations(text);
    check(`redacts ${label}`, r.text.includes(REDACTION) && r.redactedCount > 0, r.text);
    check(`no digits survive: ${label}`, !/\d{2,}/.test(r.text.replace(/\[[^\]]*\]/g, "")), r.text);
  }

  /**
   * The other half: orientation must pass through untouched. A guard that
   * eats ordinary legal prose makes the general answer useless, and useless is
   * how a safety feature gets switched off.
   */
  const mustPass = [
    "عقد المقاولة يخضع في الأصل لأحكام القانون المدني، وتدور مسؤولية المقاول حول ضمان العيوب.",
    "الاختصاص في هذه المنازعة ينعقد لمحكمة البداية بصفتها الحقوقية.",
    "يُنظر إلى الإثراء بلا سبب باعتباره مصدراً مستقلاً للالتزام.",
    "راجع قانون أصول المحاكمات المدنية في باب الطعون.",
    "الدعوى العمالية معفاة من الرسوم القضائية.",
  ];

  for (const text of mustPass) {
    const scan = scanForCitations(text);
    check(`passes orientation prose: ${text.slice(0, 34)}…`, scan.clean === true, scan.found);
  }

  // A clean answer must come back byte-identical — no normalisation surprises.
  const clean = mustPass[0];
  check("clean text is returned unchanged", redactCitations(clean).text === clean);
  check("clean text reports zero redactions", redactCitations(clean).redactedCount === 0);

  // Multiple citations in one answer: all of them, not just the first.
  const many = "المادة 5 والمادة 12 وقرار رقم 100/2020 كلها ذات صلة.";
  const manyR = redactCitations(many);
  check("redacts every citation, not just the first", manyR.redactedCount >= 3, manyR);
  check("no bare number survives a multi-citation answer", !/\b\d+\b/.test(manyR.text.replace(/\[[^\]]*\]/g, "")), manyR.text);

  check("empty text is clean", scanForCitations("").clean === true);
  check("redaction marker is visible, not a silent delete", REDACTION.length > 0 && REDACTION.includes("محجوب"));
}

// ---------------------------------------------------------------- pricing
console.log("\n[pricing]");
{
  // Every model any provider can be pointed at must be priced. An unpriced
  // model doesn't error — it falls back and the dashboard under-reports
  // silently, which is the worst way for a cost number to be wrong.
  const mustBePriced = [
    "gpt-4o-mini",
    "text-embedding-3-small",
    "text-embedding-3-large",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "voyage-3-large",
  ];
  for (const m of mustBePriced) check(`${m} is priced`, isPriced(m), m);

  check("unknown model is reported as unpriced", isPriced("some-future-model") === false);
  check("unknown model still returns a number, not NaN", Number.isFinite(estimateCost("some-future-model", 1000, 1000)));

  // 1M in + 1M out at $5/$25 = $30.
  check("opus priced at its published rate", estimateCost("claude-opus-4-8", 1_000_000, 1_000_000) === 30, estimateCost("claude-opus-4-8", 1_000_000, 1_000_000));
  // Embeddings have no output side; passing output tokens must not invent cost.
  check("embedding output side is free", estimateCost("text-embedding-3-small", 1_000_000, 1_000_000) === 0.02);
  check("zero tokens costs zero", estimateCost("gpt-4o-mini", 0, 0) === 0);

  /**
   * The gap that decides the whole cost model for a public, no-login app.
   * If this ever narrows to <10x, revisit the default in .env.example.
   */
  const opus = estimateCost("claude-opus-4-8", 1_000_000, 1_000_000);
  const mini = estimateCost("gpt-4o-mini", 1_000_000, 1_000_000);
  check("opus is >10x gpt-4o-mini — the default matters", opus > mini * 10, `opus=$${opus} mini=$${mini}`);
}

// ---------------------------------------------------------------- ssl
console.log("\n[postgres ssl]");
{
  // Loopback: the VPS's own docker-compose Postgres. No TLS, no certificate.
  check("localhost gets no ssl", sslFor("postgresql://u:p@localhost:5432/db") === false);
  check("127.0.0.1 gets no ssl", sslFor("postgresql://u:p@127.0.0.1:5432/db") === false);
  check('compose service "db" gets no ssl', sslFor("postgresql://u:p@db:5432/ai_legal") === false);

  /**
   * The reason this file exists. pg enables SSL only when the URL asks for it.
   * Neon's copy-paste URL carries ?sslmode=require and connects; Supabase's
   * does not, so the driver connects in the clear, the server rejects it, and
   * the error mentions neither SSL nor the fix.
   */
  const supabase = sslFor("postgresql://postgres:p@db.abc.supabase.co:5432/postgres");
  check("remote host without sslmode gets ssl forced on", supabase !== false, supabase);
  check("forced ssl still validates the certificate", (supabase as any)?.rejectUnauthorized === true, supabase);

  // An explicit sslmode is the operator's decision; hand it to pg untouched.
  check(
    "explicit sslmode=require is left to pg",
    sslFor("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require") === false
  );
  check("explicit sslmode=disable is honoured, not overridden", sslFor("postgresql://u:p@remote.example.com/db?sslmode=disable") === false);

  check("a garbled url is left to pg to reject", sslFor("not a url") === false);

  // poolConfig must not emit `ssl` at all when none is wanted — passing
  // `ssl: false` explicitly is not the same as omitting it for some drivers.
  check("poolConfig omits ssl for local", !("ssl" in poolConfig("postgresql://u:p@localhost:5432/db")));
  check("poolConfig includes ssl for remote", "ssl" in poolConfig("postgresql://u:p@db.abc.supabase.co:5432/postgres"));
  check(
    "poolConfig passes the connection string through",
    poolConfig("postgresql://u:p@localhost:5432/db").connectionString === "postgresql://u:p@localhost:5432/db"
  );
}

// ---------------------------------------------------------------- html
console.log("\n[html extraction]");
{
  // Shaped like a jc.jo decision page: real content inside a container, and
  // the same nav/footer boilerplate every page on that site carries.
  const HTML = `<html><head><title>قرارات الديوان الخاص بتفسير القانون - المجلس القضائي</title></head>
<body>
  <nav>الرئيسية عن المجلس اتصل بنا</nav>
  <header>تصفح بأمان ضوء التباين حجم الخط</header>
  <script>var x = "لا يجب أن يظهر هذا";</script>
  <style>.a{color:red}</style>
  <div id="MainContent_DivContent">
    <p>قرار رقم (2) صادر عن الديوان الخاص بتفسير القوانين تاريخ 9 / 2 /2015</p>
    <p>اجتمع الديوان الخاص بتفسير القوانين بنصابه القانوني برئاسة رئيس محكمة التمييز<br>وعضوية نائبي رئيس المحكمة.</p>
    <div>وحيث أن المادة 5 من القانون تنص على ما يلي.</div>
  </div>
  <footer>جميع الحقوق محفوظة</footer>
</body></html>`;

  const text = extractHtmlText(HTML, "#MainContent_DivContent");
  check("extracts the container's text", text.includes("قرار رقم (2)"), text.slice(0, 60));
  check("keeps digits intact", text.includes("9 / 2 /2015") && text.includes("المادة 5"));
  check("excludes nav", !text.includes("اتصل بنا"), text);
  check("excludes footer", !text.includes("جميع الحقوق"));
  check("excludes script contents", !text.includes("لا يجب أن يظهر هذا"));

  // <br> and block ends carry the paragraph structure the chunker cuts on;
  // cheerio's .text() would run straight through them.
  check("br becomes a newline", /التمييز\s*\n\s*وعضوية/.test(text), JSON.stringify(text));
  check("block elements are separated", text.split("\n").filter((l) => l.trim()).length >= 3);

  check("title strips the site-name suffix", extractHtmlTitle(HTML) === "قرارات الديوان الخاص بتفسير القانون", extractHtmlTitle(HTML));
  check("missing title yields null", extractHtmlTitle("<html><body>x</body></html>") === null);

  // A silently-empty selector would write a file of nav text and call it law.
  check("unmatched selector throws", (() => {
    try { extractHtmlText(HTML, "#nope"); return false; } catch { return true; }
  })());
}

// ---------------------------------------------------------------- classify
console.log("\n[classify: source type]");
{
  const t = (p: string, explicit?: string) => classifySource(p, explicit).type;

  // Real filenames from moj.gov.jo.
  check("قانون → law", t("/d/قانون_العقوبات_وتعديلاته_رقم_16_لسنة_1960.pdf") === "law");
  check("نظام → regulation", t("/d/نظام_رسوم_الكاتب_العدل_2026.pdf") === "regulation");
  check("تعليمات → instruction", t("/d/تعليمات_المراقبة_الالكترونية_2025.pdf") === "instruction");
  check("التعليمات (with al-) → instruction", t("/d/التعليمات_الناظمة_للبيع_بالمزاد_الالكتروني.pdf") === "instruction");
  // Corpus repair (2026-10): both files below are listed by moj.gov.jo under
  // its REGULATIONS (deploy/sources/moj-regulations-ar.txt). A fee schedule
  // ("لائحة أجور") was filed as a pleading template and an executive decision
  // as a court decision; only a pleading ("لائحة دعوى") is a template.
  check("لائحة أجور (fee schedule) → regulation", t("/d/لائحة_أجور_أتعاب_الكاتب_العدل_المرخص_لسنة_2015.pdf") === "regulation");
  check("لائحة دعوى (pleading) → template", t("/d/لائحة_دعوى_مطالبة_مالية.docx") === "template");
  check("قرار بتحديد (executive decision) → instruction", t("/d/قرار_بتحديد_الصحف_الاوسع_انتشارا_لسنة_2021.pdf") === "instruction");
  check("قرار (court decision) → court_decision", t("/d/قرار_محكمة_التمييز_رقم_1234_لسنة_2020.pdf") === "court_decision");

  /**
   * Regression: "نظام معدل لنظام المساعدة القانونية" contains "القانونية",
   * which contains "قانون". The first version checked law before regulation
   * and filed this regulation as a law.
   */
  check(
    "regulation mentioning القانونية is not filed as a law",
    t("/d/نظام_معدل_لنظام_المساعدة_القانونية_رقم_53_لسنة_2022.pdf") === "regulation",
    t("/d/نظام_معدل_لنظام_المساعدة_القانونية_رقم_53_لسنة_2022.pdf")
  );
  check(
    "instruction about legal aid is not filed as a law",
    t("/d/تعليمات_تنظيم_المساعدة_القانونية_المقدمة_من_وزارة_العدل.pdf") === "instruction"
  );

  /**
   * Regression: a download folder named "moj-laws" contains "law", and the
   * first version matched against the whole path — stamping "law" onto every
   * regulation and instruction inside it.
   */
  check(
    "folder name does not override a clear filename",
    t("/downloads/moj-laws/نظام_رسوم_الكاتب_العدل_2026.pdf") === "regulation",
    t("/downloads/moj-laws/نظام_رسوم_الكاتب_العدل_2026.pdf")
  );
  check(
    "folder is still used when the filename says nothing",
    classifySource("/downloads/tamyeez/scan_0012.pdf").basis === "folder"
  );

  /**
   * Regression: the Constitution ships as الفصل01..الفصل10. Nothing matched,
   * and the old default of "court_decision" filed the Constitution as a court
   * ruling. Now it returns null so the caller must decide.
   */
  check("unknown filename yields null, not a guess", t("/d/الفصل01.pdf") === null, t("/d/الفصل01.pdf"));
  check("unknown basis is reported", classifySource("/d/الفصل01.pdf").basis === "unknown");
  check("explicit --type wins over everything", t("/d/الفصل01.pdf", "law") === "law");
  check("explicit --type overrides a filename hint", t("/d/قانون_العقوبات.pdf", "template") === "template");

  check("leading token beats a later mention", t("/d/تعليمات_تطبيق_نظام_المحاكم.pdf") === "instruction");

  /**
   * Regression: the leading-token table was written with `\b`, which in JS is
   * defined against [A-Za-z0-9_] and therefore never matches after an Arabic
   * letter. Every pattern in it was dead and classification silently fell
   * through to the substring table. The type came out right often enough that
   * asserting only on `type` kept passing — so these assert on `basis`, which
   * is what actually proves the path ran.
   */
  const b = (p: string) => classifySource(p).basis;
  check("leading-token path actually runs for نظام", b("/d/نظام_رسوم_الكاتب_العدل_2026.pdf") === "filename-leading", b("/d/نظام_رسوم_الكاتب_العدل_2026.pdf"));
  check("leading-token path actually runs for تعليمات", b("/d/تعليمات_شؤون_الخبرة_لسنة_2018.pdf") === "filename-leading");
  check("leading-token path actually runs for قانون", b("/d/قانون_العقوبات_وتعديلاته.pdf") === "filename-leading");
  check("leading-token path actually runs for لائحة", b("/d/لائحة_أجور_أتعاب_الكاتب_العدل.pdf") === "filename-leading");

  /**
   * The case that exposed it: a regulation whose title names محكمة التمييز.
   * Without a working leading-token check it was filed as a court decision.
   */
  check(
    "نظام naming محكمة التمييز stays a regulation",
    t("/d/نظام_المكتب_الفني_لمحكمة_التمييز_وتعديلاته_رقم_7_لسنة_2010.pdf") === "regulation",
    t("/d/نظام_المكتب_الفني_لمحكمة_التمييز_وتعديلاته_رقم_7_لسنة_2010.pdf")
  );
  check(
    "نظام naming الاجراءات الجزائية stays a regulation",
    t("/d/نظام_استخدام_وسائل_التقنية_الحديثة_في_الاجراءات_الجزائية_رقم_96.pdf") === "regulation"
  );

  // The guard must not fire on a longer word that merely starts the same way.
  check("نظامية is not treated as a leading نظام", b("/d/نظامية_شيء_ما.pdf") !== "filename-leading");
  check("invalid explicit type throws", (() => {
    try { classifySource("/d/x.pdf", "nonsense"); return false; } catch { return true; }
  })());
}

// ---------------------------------------------------------------- law identity
console.log("\n[law identity: number / year / amendment lineage]");
{
  // Amendment detection: the leading معدل marker, not a later mention.
  check("detects amending law", isAmendingTitle("قانون معدل لقانون العقوبات رقم 10 لسنة 2022") === true);
  check("detects معدّل with shadda", isAmendingTitle("قانون معدّل لقانون العمل") === true);
  check("detects نظام amendment", isAmendingTitle("نظام معدل لنظام المساعدة القانونية رقم 53 لسنة 2022") === true);
  check("original law is not an amendment", isAmendingTitle("قانون العمل الأردني رقم 8 لسنة 1996") === false);
  check(
    "a subject mentioning تعديل is not an amendment",
    isAmendingTitle("قانون تعديل أوضاع المخالفين") === false,
    isAmendingTitle("قانون تعديل أوضاع المخالفين")
  );

  // Number + year parsing, including Arabic-Indic digits.
  check("parses law number", parseLawNumber("قانون العمل رقم 8 لسنة 1996") === "8", parseLawNumber("قانون العمل رقم 8 لسنة 1996"));
  check("parses parenthesised number", parseLawNumber("قانون رقم (12) لسنة 2025") === "12");
  check("parses Arabic-Indic number", parseLawNumber("قانون رقم ٢٢ لسنة ١٩٩٧") === "22", parseLawNumber("قانون رقم ٢٢ لسنة ١٩٩٧"));
  check("no number when title states only a year", parseLawNumber("القانون المدني") === null);
  check("parses year framed as لسنة", parseLawYear("قانون العمل رقم 8 لسنة 1996") === 1996);
  check("parses Arabic-Indic year", parseLawYear("قانون رقم ٢٢ لسنة ١٩٩٧") === 1997, parseLawYear("قانون رقم ٢٢ لسنة ١٩٩٧"));
  check("no year when title has none", parseLawYear("قانون بلا سنة") === null);

  // Base-name extraction from an amending title — the shared name, not the number.
  check(
    "base name of a penal-code amendment",
    baseLawName("قانون معدل لقانون العقوبات رقم 10 لسنة 2022") === "قانون العقوبات",
    baseLawName("قانون معدل لقانون العقوبات رقم 10 لسنة 2022")
  );
  check(
    "base name strips وتعديلاته",
    baseLawName("قانون معدل لقانون التنفيذ وتعديلاته رقم 9 لسنة 2022") === "قانون التنفيذ",
    baseLawName("قانون معدل لقانون التنفيذ وتعديلاته رقم 9 لسنة 2022")
  );
  check(
    "base name of a regulation amendment keeps نظام",
    baseLawName("نظام معدل لنظام المساعدة القانونية رقم 53 لسنة 2022") === "نظام المساعدة القانونية",
    baseLawName("نظام معدل لنظام المساعدة القانونية رقم 53 لسنة 2022")
  );
  check("original law has no base name", baseLawName("قانون العمل رقم 8 لسنة 1996") === null);
}

// ---------------------------------------------------------------- validation
console.log("\n[validate: pre-ingest metadata gate]");
{
  // A complete base law passes.
  const okLaw = validateSourceMetadata({
    title: "قانون التجارة الأردني رقم 12 لسنة 1966",
    sourceType: "law",
    lawNumber: "12",
    year: 1966,
    effectiveDate: "1966-01-01",
  });
  check("complete law passes", okLaw.ok === true, okLaw.errors);

  // Each missing legislative field is caught.
  const noNumber = validateSourceMetadata({ title: "قانون ما", sourceType: "law", year: 2000, effectiveDate: "2000-01-01" });
  check("missing law number is rejected", noNumber.ok === false && noNumber.errors.some((e) => e.includes("رقم")), noNumber.errors);

  const noYear = validateSourceMetadata({ title: "قانون ما", sourceType: "law", lawNumber: "5", effectiveDate: "2000-01-01" });
  check("missing year is rejected", noYear.ok === false && noYear.errors.some((e) => e.includes("سنة")), noYear.errors);

  const noDate = validateSourceMetadata({ title: "قانون ما", sourceType: "law", lawNumber: "5", year: 2000 });
  check("missing effective date is rejected", noDate.ok === false && noDate.errors.some((e) => e.includes("نفاذ")), noDate.errors);

  const noTitle = validateSourceMetadata({ sourceType: "law", lawNumber: "5", year: 2000, effectiveDate: "2000-01-01" });
  check("missing title is rejected", noTitle.ok === false && noTitle.errors.some((e) => e.includes("العنوان")), noTitle.errors);

  const badType = validateSourceMetadata({ title: "شيء", sourceType: "nonsense" });
  check("invalid type is rejected", badType.ok === false && badType.errors.some((e) => e.includes("نوع")), badType.errors);

  const badDate = validateSourceMetadata({ title: "قانون ما", sourceType: "law", lawNumber: "5", year: 2000, effectiveDate: "2024-02-31" });
  check("impossible calendar date is rejected", badDate.ok === false, badDate.errors);

  const badFormat = validateSourceMetadata({ title: "قانون ما", sourceType: "law", lawNumber: "5", year: 2000, effectiveDate: "1/1/2000" });
  check("non-ISO date is rejected", badFormat.ok === false, badFormat.errors);

  // The amendment-link rule — the core "no unlinked conflicting version".
  const unlinked = validateSourceMetadata({
    title: "قانون معدل لقانون العقوبات رقم 10 لسنة 2022",
    sourceType: "law",
    lawNumber: "10",
    year: 2022,
    effectiveDate: "2022-05-16",
  });
  check(
    "amending law with no base link is rejected",
    unlinked.ok === false && unlinked.errors.some((e) => e.includes("معدّل")),
    unlinked.errors
  );

  const linked = validateSourceMetadata({
    title: "قانون معدل لقانون العقوبات رقم 10 لسنة 2022",
    sourceType: "law",
    lawNumber: "10",
    year: 2022,
    effectiveDate: "2022-05-16",
    amendmentOf: 3,
  });
  check("amending law linked to its base passes", linked.ok === true, linked.errors);

  // Non-legislation is exempt from law-number / date, needs only title + type.
  const decision = validateSourceMetadata({ title: "قرار تمييز حقوق 1234/2020", sourceType: "court_decision" });
  check("court decision needs no law number", decision.ok === true, decision.errors);
  const template = validateSourceMetadata({ title: "نموذج لائحة دعوى", sourceType: "template" });
  check("template needs no law number", template.ok === true, template.errors);
}

// ---------------------------------------------------------------- versioning
console.log("\n[legal versioning: temporal intent + version scope]");
{
  // Default: no temporal signal → current version only.
  const plain = parseIntent("ما نص المادة 5 من قانون العمل؟");
  check("plain question is not historical", plain.wantsHistorical === false, plain);
  check("plain question has no as-of year", plain.asOfYear === null, plain.asOfYear);
  const plainScope = resolveVersionScope(plain);
  check("plain question → current only", plainScope.currentOnly === true && plainScope.asOfDate === null, plainScope);

  // A law's OWN year must NOT be read as an as-of date (the core trap).
  const own = parseIntent("قانون العمل رقم 8 لسنة 1996");
  check("law's own year is not an as-of year", own.asOfYear === null, own.asOfYear);
  check("law's own year is not historical", own.wantsHistorical === false, own);
  check("citation by year still resolves to current only", resolveVersionScope(own).currentOnly === true);

  // Explicit as-of framing → historical, with the year.
  const asOf = parseIntent("ماذا كان ينص قانون العمل في عام 2015؟");
  check("as-of year is extracted", asOf.asOfYear === 2015, asOf.asOfYear);
  check("as-of question is historical", asOf.wantsHistorical === true, asOf);
  const asOfScope = resolveVersionScope(asOf);
  check("as-of → not current only", asOfScope.currentOnly === false, asOfScope);
  check("as-of → capped by end of that year", asOfScope.asOfDate === "2015-12-31", asOfScope.asOfDate);

  // Historical keyword with no year → historical, no date cap.
  const prev = parseIntent("ما هي النسخة السابقة من هذه المادة قبل التعديل؟");
  check("previous-version wording is historical", prev.wantsHistorical === true, prev);
  check("historical with no year has null as-of year", prev.asOfYear === null, prev.asOfYear);
  const prevScope = resolveVersionScope(prev);
  check("previous-version → not current only, no date cap", prevScope.currentOnly === false && prevScope.asOfDate === null, prevScope);

  // "قبل 2019" (bare preposition + year) is historical too.
  const before = parseIntent("كيف كانت المادة قبل 2019؟");
  check("قبل + year is an as-of signal", before.asOfYear === 2019 && before.wantsHistorical === true, before);

  // A future year is not a valid as-of date.
  const future = parseIntent("ما القانون في عام 2099؟");
  check("a future year is not treated as as-of", future.asOfYear === null, future.asOfYear);
}

// ---------------------------------------------------------------- query understanding
console.log("\n[query understanding: rule tier]");
{
  // The six types, each from its canonical example.
  const lookup = analyzeQueryRules("ما المادة 421؟");
  check("article number → article_lookup", lookup.queryType === "article_lookup", lookup.queryType);
  check("article_lookup is confident (no LLM)", lookup.confidence >= 0.7, lookup.confidence);
  check("article_lookup needs no expansion", lookup.needsExpansion === false, lookup);

  const def = analyzeQueryRules("ما معنى إساءة الائتمان؟");
  check("‘ما معنى’ → legal_definition", def.queryType === "legal_definition", def.queryType);
  check("definition detects the concept", def.legalConcepts.includes("إساءة الائتمان"), def.legalConcepts);
  check("definition maps to قانون العقوبات", def.expectedLaw === "قانون العقوبات", def.expectedLaw);
  check("definition area is جزائي", def.legalArea === "جزائي", def.legalArea);

  const doctrinal = analyzeQueryRules("ما الفرق بين القرض والأمانة؟");
  check("‘الفرق بين’ → doctrinal_question", doctrinal.queryType === "doctrinal_question", doctrinal.queryType);
  check("doctrinal needs expansion", doctrinal.needsExpansion === true, doctrinal);
  check("doctrinal picks up both concepts", doctrinal.legalConcepts.some((c) => c.includes("القرض")) && doctrinal.legalConcepts.some((c) => c.includes("الأمانة")), doctrinal.legalConcepts);

  const fact = analyzeQueryRules("شخص أخذ مالاً من آخر وقال إنه قرض وليس أمانة");
  check("actor + action + claim → fact_pattern", fact.queryType === "fact_pattern", fact.queryType);
  check("fact_pattern needs expansion", fact.needsExpansion === true, fact);
  check("fact_pattern is confident from rules", fact.confidence >= 0.7, fact.confidence);

  const draft = analyzeQueryRules("اكتب لي لائحة دعوى مطالبة بمبلغ من المال");
  check("draft verb + doc type → drafting_request", draft.queryType === "drafting_request", draft.queryType);
  check("drafting needs no expansion", draft.needsExpansion === false, draft);

  const review = analyzeQueryRules("راجع هذا العقد وبيّن الخلل في بنوده");
  check("review verb + contract → contract_review", review.queryType === "contract_review", review.queryType);

  // The cheque example — the whole point of expectedLaw.
  const cheque = analyzeQueryRules("ما حكم إصدار شيك بدون رصيد؟");
  check("‘شيك بدون رصيد’ → قانون التجارة", cheque.expectedLaw === "قانون التجارة", cheque.expectedLaw);
  check("cheque area is تجاري", cheque.legalArea === "تجاري", cheque.legalArea);

  // Latency guarantee: every clear example resolves confidently, so the LLM
  // fallback never runs for them.
  for (const q of ["ما المادة 5؟", "ما معنى الوديعة؟", "ما الفرق بين الجنحة والجناية؟", "اكتب مذكرة دفاع"]) {
    check(`rules confident (no LLM) for: ${q}`, analyzeQueryRules(q).confidence >= 0.7, analyzeQueryRules(q).confidence);
  }

  // An ambiguous one-liner with no signal is left low-confidence for the LLM.
  const vague = analyzeQueryRules("الوضع القانوني للأمر برمته");
  check("vague query is low-confidence (would use LLM)", vague.confidence < 0.7, vague.confidence);
  check("rules method is tagged", vague.method === "rules", vague.method);

  // keywords drop question words, keep legal terms.
  check("keywords exclude question words", !def.keywords.includes("ما") && !def.keywords.includes("معنى"), def.keywords);
}

// ---------------------------------------------------------------- ontology
console.log("\n[legal ontology: lay wording → statutory terms]");
{
  // The case the whole layer exists for: the lawyer's facts vs the statute.
  const amana = expandWithOntology("موكلي أخذ مبلغ وقال إنه قرض وليس أمانة");
  check("lay 'أخذ مبلغ وقال إنه قرض' matches the amana concept", amana.terms.length > 0, amana.matches);
  check(
    "expands to the statutory phrase",
    amana.terms.some((t) => t.includes("مال مسلم على وجه الأمانة")),
    amana.terms
  );
  check("expands to خيانة الأمانة", amana.terms.some((t) => t.includes("خيانة الأمانة")), amana.terms);

  const cheque = expandWithOntology("زبون أعطاني شيك بدون رصيد");
  check("cheque lay term matches", cheque.terms.length > 0, cheque.matches);
  check(
    "cheque expands to مقابل وفاء",
    cheque.terms.some((t) => t.includes("مقابل وفاء")),
    cheque.terms
  );

  const fasl = expandWithOntology("صاحب العمل فصل موظف بدون سبب");
  check("dismissal lay term matches", fasl.terms.some((t) => t.includes("فصل تعسفي")), fasl.terms);
  check("dismissal expands to إنهاء عقد العمل", fasl.terms.some((t) => t.includes("إنهاء عقد العمل")), fasl.terms);

  // Must not add a term the question already contains — that is noise, not
  // expansion.
  const already = expandWithOntology("ما هي شروط الفصل التعسفي وإنهاء عقد العمل؟");
  check(
    "does not re-add terms already in the question",
    !already.terms.some((t) => t === "فصل تعسفي" || t === "إنهاء عقد العمل"),
    already.terms
  );

  // An unrelated question expands to nothing.
  const none = expandWithOntology("ما هي اختصاصات المحكمة الدستورية؟");
  check("unrelated question gets no expansion", none.terms.length === 0, none.terms);

  // Data hygiene: every entry must be non-empty and free of stray Latin text
  // (a mixed-script trigger silently never matches).
  const badEntry = LEGAL_ONTOLOGY.find(
    (e) => e.triggers.length === 0 || e.statutory.length === 0 || [...e.triggers, ...e.statutory].some((s) => /[A-Za-z]/.test(s))
  );
  check("every ontology entry is well-formed Arabic", badEntry === undefined, badEntry?.concept);
}

// ---------------------------------------------------------------- or-tsquery
console.log("\n[query expansion: OR tsquery builder]");
{
  const q = toOrTsQuery(["مقابل وفاء", "شيك مرتجع"]);
  check("phrases become AND-groups OR'd together", q === "مقابل & وفاء | شيك & مرتجع", q);
  check("single word needs no operator", toOrTsQuery(["الاحتيال"]) === "الاحتيال", toOrTsQuery(["الاحتيال"]));
  check("empty input yields empty string", toOrTsQuery([]) === "", toOrTsQuery([]));
  // Output is FOLDED (ة→ه …) on purpose: it is matched against content_tsv,
  // which is generated from folded_text, so an unfolded tsquery would miss.
  const dup = toOrTsQuery(["السرقة", "السرقة"]);
  check("duplicate phrases are collapsed to one group", !dup.includes("|") && dup.length > 0, dup);
  check("builder emits folded terms to match content_tsv", dup === foldForSearch("السرقة"), dup);

  /**
   * The string goes straight to to_tsquery(), which throws on stray operator
   * characters — so nothing but Arabic/word chars and our own & | may survive.
   */
  const dirty = toOrTsQuery(["شيك (بدون) رصيد!", "مال: مسلَّم & على وجه الأمانة"]);
  check("sanitises tsquery operators out of the terms", !/[():!]/.test(dirty), dirty);
  check("sanitised output still has content", dirty.length > 0, dirty);
  check("no doubled operators survive", !/&\s*&|\|\s*\|/.test(dirty), dirty);
}

// ---------------------------------------------------------------- confidence
console.log("\n[dynamic threshold + confidence]");
{
  const chunk = (v: number | null, k: number | null = null, both = false) =>
    ({ vector_score: v, keyword_score: k, matched_by: both ? "both" : "vector", rerank_score: null }) as any;

  // ---- dynamic floor per query type ----
  const lookup = resolveThresholds("article_lookup");
  const fact = resolveThresholds("fact_pattern");
  const def = resolveThresholds("legal_definition");
  check("article_lookup gets the strictest floor", lookup.minVectorScore > def.minVectorScore, lookup.minVectorScore);
  check("fact_pattern gets the widest net", fact.minVectorScore < def.minVectorScore, fact.minVectorScore);
  check(
    "every floor is tighter than the old flat 0.3",
    [lookup, def, fact].every((t) => t.minVectorScore > 0.3),
    [lookup.minVectorScore, def.minVectorScore, fact.minVectorScore]
  );
  /**
   * The measured guard-rail: the weakest on-topic top score observed on the
   * live corpus was 0.458. No floor may exceed it, or a legitimate question
   * loses every result it had.
   */
  check(
    "no floor exceeds the weakest observed on-topic score (0.458)",
    [lookup, def, fact].every((t) => t.minVectorScore < 0.458),
    [lookup.minVectorScore, def.minVectorScore, fact.minVectorScore]
  );

  check("a reranker loosens the floor", resolveThresholds("fact_pattern", { reranked: true }).minVectorScore < fact.minVectorScore);
  check("expansion loosens the keyword floor", resolveThresholds("fact_pattern", { expanded: true }).minKeywordScore < fact.minKeywordScore);

  // ---- the gate ----
  check("exact citation hit bypasses the floor entirely", gateChunk(chunk(0.05), true, lookup) === true);
  check("weak non-exact chunk is gated out", gateChunk(chunk(0.2), false, lookup) === false);
  check("strong chunk passes", gateChunk(chunk(0.6), false, lookup) === true);
  check("keyword-only hit passes on lexical overlap", gateChunk(chunk(null, 0.4), false, def) === true);
  check("keyword-only noise is gated out", gateChunk(chunk(null, 0.001), false, def) === false);

  // ---- confidence ----
  const none = computeConfidence([], { queryType: "doctrinal_question" });
  check("no sources → zero confidence", none.score === 0 && none.label === "لا يوجد", none);

  // An article lookup that found the named article: exactness dominates.
  const lookupHit = computeConfidence(
    Array.from({ length: 6 }, () => chunk(0.6)),
    { queryType: "article_lookup", exactHit: true }
  );
  check("article_lookup with an exact hit is high confidence", lookupHit.label === "عالية", lookupHit);
  check("exactness is the dominant factor for a lookup", lookupHit.factors.exactness > lookupHit.factors.relevance, lookupHit.factors);

  // Same evidence WITHOUT the exact hit must score materially lower.
  const lookupMiss = computeConfidence(
    Array.from({ length: 6 }, () => chunk(0.6)),
    { queryType: "article_lookup", exactHit: false }
  );
  check("a lookup that missed its article loses confidence", lookupMiss.score < lookupHit.score - 0.3, {
    hit: lookupHit.score,
    miss: lookupMiss.score,
  });

  // A concept question is judged on retrieval strength, not on citations.
  const strong = computeConfidence(Array.from({ length: 6 }, () => chunk(0.62)), { queryType: "doctrinal_question" });
  const weak = computeConfidence([chunk(0.46)], { queryType: "doctrinal_question" });
  check("strong, well-corroborated concept answer scores high", strong.score > 0.7, strong.score);
  check("single weak source scores low", weak.label === "منخفضة", weak);
  check("more corroborating sources raise confidence", strong.factors.corroboration > weak.factors.corroboration);

  // Rerank and vector scores must never be blended — they are different scales.
  const rr = computeConfidence(
    [{ ...chunk(0.1), rerank_score: 0.9 } as any],
    { queryType: "fact_pattern", reranked: true }
  );
  check("a reranked hit is scored on its rerank score, not its weak cosine", rr.factors.relevance > 0.3, rr.factors);

  check("score never leaves 0..1", [none, lookupHit, strong, weak, rr].every((r) => r.score >= 0 && r.score <= 1));
  check("reason is human-readable Arabic", /مصدر/.test(strong.reason), strong.reason);
}

// ---------------------------------------------------------------- false-refusal recovery
console.log("\n[false-refusal recovery]");
{
  const src = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: 1,
      source_id: 1,
      source_title: "قانون العمل رقم 8 لسنة 1996",
      source_type: "law",
      chunk_text: "يلتزم صاحب العمل بدفع أجر العامل خلال المدة المتفق عليها.",
      article_number: "23",
      law_name: "قانون العمل",
      law_number: "8",
      part: null,
      chapter: null,
      section: null,
      court: null,
      decision_number: null,
      year: 1996,
      category: null,
      keywords: null,
      legal_topics: null,
      vector_score: 0.55,
      keyword_score: 0.1,
      stem_score: null,
      score: 0.05,
      matched_by: "vector",
      ...over,
    }) as any;

  // ---- isRefusal: the detection half of the requirement ----
  check("exact refusal sentence is detected", isRefusal(NO_BASIS_ANSWER));
  check("quoted refusal sentence is still detected", isRefusal(`"${NO_BASIS_ANSWER}"`));
  check("refusal detected with leading/trailing whitespace", isRefusal(`  ${NO_BASIS_ANSWER}  `));
  check("a real grounded answer is not a refusal", !isRefusal("يلتزم صاحب العمل بدفع الأجر خلال المدة المتفق عليها [1]."));
  check(
    "refusal sentence embedded mid-answer is NOT a full refusal (that's the gap-marker path's job)",
    !isRefusal(`الجزء الأول مُجاب [1]. أما الجزء الثاني فـ${NO_BASIS_ANSWER}`)
  );

  // ---- EXHAUSTED_FALLBACK_ANSWER: distinct from NO_BASIS_ANSWER on purpose ----
  check(
    "exhausted-fallback message is not the same string as the mid-generation refusal",
    (EXHAUSTED_FALLBACK_ANSWER as string) !== NO_BASIS_ANSWER
  );
  check("exhausted-fallback message matches the spec's exact wording", EXHAUSTED_FALLBACK_ANSWER === "تعذر العثور على إجابة قانونية مناسبة.");
  check("exhausted-fallback message does not itself trip isRefusal", !isRefusal(EXHAUSTED_FALLBACK_ANSWER));

  // ---- buildDirectSourceAnswer: the deterministic, no-model-call backstop ----
  const twoChunks = [src({ id: 1 }), src({ id: 2, article_number: "24", chunk_text: "نص المادة 24 عن ساعات العمل." })];
  const direct = buildDirectSourceAnswer(twoChunks);
  check("direct-source answer cites every retrieved chunk", direct.includes("[1]") && direct.includes("[2]"), direct);
  check(
    "direct-source answer quotes each chunk's verbatim text",
    twoChunks.every((c) => direct.includes(c.chunk_text)),
    direct
  );
  check("direct-source answer never contains the refusal sentence", !direct.includes(NO_BASIS_ANSWER), direct);
  check("direct-source answer names the law and article per source", direct.includes("قانون العمل") && direct.includes("المادة 23"), direct);
  check("direct-source answer is never itself flagged as a refusal", !isRefusal(direct), direct);

  // ---- formatSourcesHighlighted: the "source highlighting" half ----
  const highlighted = formatSourcesHighlighted([src()]);
  const identityHits = highlighted.split("قانون العمل").length - 1;
  check("highlighted source repeats its citation identity (bookended, not shown once)", identityHits >= 2, identityHits);
  check("highlighted source is visually distinct from the plain rendering", highlighted.includes("━"), highlighted);

  // ---- buildStrongGroundingPrompt: the careful re-read ----
  // Phase 2 changed this deliberately: the re-read used to BAN the refusal
  // ("لا ترفض الإجابة") — ordering an answer from sources the model had just
  // judged insufficient, i.e. hallucination pressure. It now asks for a
  // source-by-source re-read and keeps the right to conclude "insufficient".
  const { system: fgSystem, user: fgUser } = buildStrongGroundingPrompt("ما حقوق العامل؟", [src()]);
  check("re-read prompt asks for a careful source-by-source reading", fgSystem.includes("قراءة ثانية متأنية"), fgSystem);
  check("re-read prompt keeps the right to conclude the sources are insufficient", fgSystem.includes("هذا جواب صحيح ومقبول"), fgSystem);
  check("re-read prompt no longer bans the refusal outright", !fgUser.includes("لا ترفض الإجابة") && !fgSystem.includes("الرفض الكامل للإجابة غير مسموح"), fgUser);
  check("re-read prompt still forbids inventing an article number", fgSystem.includes("اختراع"), fgSystem);
  check("re-read prompt carries the highlighted sources, not the plain ones", fgUser.includes("━"), fgUser);
}

// ---------------------------------------------------------------- embedding cache
console.log("\n[embedding cache]");
{
  const v1 = [0.1, 0.2, 0.3];
  const v2 = [0.9, 0.8, 0.7];
  check("miss on a key never stored returns null", getCachedEmbedding("لن يُخزَّن أبداً هذا النص") === null);

  setCachedEmbedding("نص أول", v1);
  check("hit returns the exact stored vector", getCachedEmbedding("نص أول") === v1);

  setCachedEmbedding("نص أول", v2);
  check("re-setting the same key overwrites rather than duplicating", getCachedEmbedding("نص أول") === v2);

  setCachedEmbedding("نص ثانٍ", v1);
  check("two different keys don't collide", getCachedEmbedding("نص ثانٍ") === v1 && getCachedEmbedding("نص أول") === v2);

  // Fill well past MAX_ENTRIES (500) — 510, not exactly 500, so this holds
  // regardless of the handful of entries the checks above already put in the
  // same module-level cache — and confirm the oldest untouched entries are
  // what gets evicted, not a recently-read one. That eviction-on-read
  // exemption is the whole point of moving a key to the end of the Map's
  // iteration order on every hit (see embedding-cache.ts).
  for (let i = 0; i < 510; i++) setCachedEmbedding(`مفتاح-${i}`, [i]);
  check("a fresh key beyond capacity does not throw and is retrievable", getCachedEmbedding("مفتاح-509")?.[0] === 509);
  check("the least-recently-used key was evicted to make room", getCachedEmbedding("مفتاح-0") === null);
}

// ---------------------------------------------------------------- verifyCitedNumbers
console.log("\n[verifyCitedNumbers]");
{
  // The exact real answer observed live during this session's browser
  // verification — the case that first exposed why citation-verify.ts's
  // DB-based checker (built for the Type-2 supplement) cannot be reused
  // as-is for the grounded (Type A) answer: none of these three genuine,
  // correct citations restate a "قانون … رقم N" nearby, which that checker
  // requires before accepting an article number at all.
  const realAnswer = `شروط صحة عقد البيع وفقاً للمصادر القانونية المتاحة تشمل ما يلي:

1. يجب أن يكون العقد مسجلاً لدى مديرية التسجيل ليكون ملزماً وصحيحاً، سواء كان عقد بيع بالتقسيط أو عقد وعد ببيع. حيث تنص المادة (130) على أنه "يعد عقدا ملزما وصحيحا إذا جرى تسجيل العقد لدى مديرية التسجيل" [2]، والمادة (128) تنص على نفس المبدأ بالنسبة لعقد الوعد بالبيع [3].

4. يجب أن يكون البائع مالكاً للعقار المبيع، حيث تنص المادة (17) على أنه "يجوز للمالك أن يبيع عقاره إلى آخر لقاء الإعالة" [6].`;
  const realChunks: CitableChunk[] = [
    { article_number: "999", decision_number: null },
    { article_number: "130", decision_number: null },
    { article_number: "128", decision_number: null },
    { article_number: "1", decision_number: null },
    { article_number: "1", decision_number: null },
    { article_number: "17", decision_number: null },
  ];
  const real = verifyCitedNumbers(realAnswer, realChunks);
  check("real answer: all 3 genuine citations verified, none redacted", real.verifiedCount === 3 && real.redactedCount === 0, real);
  check("real answer: text byte-identical to input (nothing touched)", real.text === realAnswer);

  // The densely-packed case that first caught a real bug in this function:
  // nearest-by-raw-distance picked the PRECEDING claim's own marker ([2],
  // ~5 chars before "المادة (128)") over the mention's actual citation ([3],
  // ~50 chars after, across a full quoted excerpt belonging to the OTHER
  // claim) — fixed by preferring the next marker after a mention over any
  // marker before it. This check pins that fix so it can't silently regress.
  check(
    "densely-packed citations: a mention's own trailing marker wins over a closer preceding one",
    real.text.includes("المادة (128)"),
    real.text
  );

  const mismatch = verifyCitedNumbers("تنص المادة (99) على كذا وكذا [1].", [{ article_number: "45", decision_number: null }]);
  check("wrong article number for the cited chunk is redacted", mismatch.redactedCount === 1 && mismatch.verifiedCount === 0, mismatch);
  check("redaction marker is guard.ts's shared REDACTION constant", mismatch.text.includes(REDACTION), mismatch.text);

  const unattributed = verifyCitedNumbers(
    "تنص المادة (500) على كذا وكذا بلا أي استشهاد قريب على الإطلاق حتى بعد هذا الحد الطويل من الكلام الذي يتجاوز مسافة البحث المحددة.",
    []
  );
  check("a number with no nearby [n] at all is treated as unverified", unattributed.redactedCount === 1 && unattributed.verifiedCount === 0);

  const simple = verifyCitedNumbers("تنص المادة (45) على كذا [1].", [{ article_number: "45", decision_number: null }]);
  check("correct citation, bracket immediately adjacent, passes through untouched", simple.verifiedCount === 1 && simple.text === "تنص المادة (45) على كذا [1].");

  const decisionOk = verifyCitedNumbers("استقر الاجتهاد في القرار رقم 1234/2020 [1] على كذا.", [{ article_number: null, decision_number: "1234" }]);
  check("correct decision number verified", decisionOk.verifiedCount === 1 && decisionOk.redactedCount === 0);
  const decisionBad = verifyCitedNumbers("استقر الاجتهاد في القرار رقم 9999/2020 [1] على كذا.", [{ article_number: null, decision_number: "1234" }]);
  check("wrong decision number redacted", decisionBad.redactedCount === 1 && decisionBad.verifiedCount === 0);

  const clean = verifyCitedNumbers("هذا نص عام بلا أي أرقام مواد أو قرارات إطلاقاً.", []);
  check("text with no citation-shaped mentions is untouched", clean.verifiedCount === 0 && clean.redactedCount === 0 && clean.text === "هذا نص عام بلا أي أرقام مواد أو قرارات إطلاقاً.");

  const two = verifyCitedNumbers("المادة (10) تنص كذا [1]. أما المادة (20) فتنص كذا [2].", [
    { article_number: "10", decision_number: null },
    { article_number: "99", decision_number: null },
  ]);
  check("two citations resolve independently: one verified, one redacted", two.verifiedCount === 1 && two.redactedCount === 1, two);
}

// ---------------------------------------------------------------- self-verify (Phase 6)
console.log("\n[self-verify: computeSeverity / decideAction / extractCitedIndices]");
{
  const none: VerificationIssue[] = [];
  check("no issues -> severity none", computeSeverity(none) === "none");

  check("HALLUCINATION_DETECTED alone -> high", computeSeverity(["HALLUCINATION_DETECTED"]) === "high");
  check("CONTRADICTION_DETECTED alone -> high", computeSeverity(["CONTRADICTION_DETECTED"]) === "high");
  check(
    "HALLUCINATION_DETECTED outranks a co-occurring lower issue -> still high",
    computeSeverity(["INCOMPLETE_ANSWER", "HALLUCINATION_DETECTED"]) === "high"
  );

  check("UNSUPPORTED_LEGAL_CLAIM alone -> medium", computeSeverity(["UNSUPPORTED_LEGAL_CLAIM"]) === "medium");
  check("INCOMPLETE_ANSWER alone -> medium", computeSeverity(["INCOMPLETE_ANSWER"]) === "medium");
  check("INVALID_CITATION alone -> medium", computeSeverity(["INVALID_CITATION"]) === "medium");
  check(
    "medium issue does not escalate to high without hallucination/contradiction",
    computeSeverity(["INCOMPLETE_ANSWER", "INVALID_CITATION"]) === "medium"
  );

  // decideAction: none/low never regenerate; medium+ regenerates on the first
  // pass and falls back to remove_claims (this codebase's safe-fallback path)
  // on the repair attempt — never loops, never returns "refuse" (see
  // self-verify.ts's own header comment for why: buildDirectSourceAnswer is
  // always a strictly safer fallback than refusing whenever chunks exist,
  // which they always do on every path this runs for).
  check("severity none -> return", decideAction("none", false) === "return");
  check("severity low -> return, even as a repair attempt", decideAction("low", true) === "return");
  check("severity medium, first pass -> regenerate", decideAction("medium", false) === "regenerate");
  check("severity high, first pass -> regenerate", decideAction("high", false) === "regenerate");
  check("severity critical, first pass -> regenerate", decideAction("critical", false) === "regenerate");
  check("severity medium, already a repair attempt -> remove_claims, not another regenerate", decideAction("medium", true) === "remove_claims");
  check("severity high, already a repair attempt -> remove_claims, not another regenerate", decideAction("high", true) === "remove_claims");
  check("decideAction never returns refuse for any severity/attempt combination", (
    (["none", "low", "medium", "high", "critical"] as const).every((s) =>
      [false, true].every((r) => decideAction(s, r) !== "refuse")
    )
  ));

  check("no [n] markers -> empty array", extractCitedIndices("نص بلا أي استشهاد.").length === 0);
  check(
    "dedupes repeated citations and returns them in ascending order",
    JSON.stringify(extractCitedIndices("تنص [3] كذا [1] وأيضاً [3] مرة أخرى [2].")) === JSON.stringify([1, 2, 3])
  );
  check(
    "adjacent bracket cluster [2][3] resolves to both indices",
    JSON.stringify(extractCitedIndices("تسجيل العقد لدى مديرية التسجيل [2][3].")) === JSON.stringify([2, 3])
  );
}

// ---------------------------------------------------------------- drafting: hasSubstantialNotes / fieldsOf / formatFields
console.log("\n[drafting: flexible-input gate + new fields]");
{
  check("empty notes are not substantial", !hasSubstantialNotes(""));
  check("short notes are not substantial", !hasSubstantialNotes("شوف الملف"));
  check(
    "a real one-sentence fact pattern is substantial",
    hasSubstantialNotes(
      "موكلي أبرم عقد مقاولة مع المدعى عليه بتاريخ 10/01/2025 بقيمة 25 ألف دينار، وقام بتنفيذ الأعمال، لكن المدعى عليه لم يدفع المبلغ المتبقي."
    )
  );

  const claimFields = fieldsOf("statement_of_claim");
  check("statement_of_claim gained an optional case_number", !!claimFields.find((f) => f.id === "case_number" && !f.required));

  const replyFields = fieldsOf("reply");
  check("reply gained a required subject field", !!replyFields.find((f) => f.id === "subject" && f.required));
  check(
    "reply gained a required plaintiff_claims_summary field",
    !!replyFields.find((f) => f.id === "plaintiff_claims_summary" && f.required)
  );

  const defenseFields = fieldsOf("defense_memo");
  check("defense_memo gained a required case_subject field", !!defenseFields.find((f) => f.id === "case_subject" && f.required));

  const petitionFields = fieldsOf("petition");
  check(
    "petition gained a required petitioner_capacity field",
    !!petitionFields.find((f) => f.id === "petitioner_capacity" && f.required)
  );

  const contractFields = fieldsOf("contract");
  const newContractIds = [
    "party_one_representative",
    "party_two_representative",
    "obligations_rights",
    "confidentiality",
    "ip_terms",
    "breach_terms",
    "penalty_clause",
    "force_majeure",
    "dispute_resolution",
    "governing_law",
  ];
  check(
    "contract gained all 10 new fields",
    newContractIds.every((id) => contractFields.some((f) => f.id === id)),
    contractFields.map((f) => f.id)
  );
  check(
    "none of the new contract fields are required",
    newContractIds.every((id) => !contractFields.find((f) => f.id === id)?.required)
  );
  const recommendedIds = contractFields.filter((f) => f.recommended).map((f) => f.id);
  check(
    "exactly duration/consideration/obligations_rights are recommended",
    recommendedIds.sort().join(",") === "consideration,duration,obligations_rights",
    recommendedIds
  );

  // Regression: formatFields must still drop an empty optional field, and
  // must still include a filled `recommended` one now that the flag exists.
  const formatted = formatFields("contract", {
    contract_type: "خدمات",
    party_one_name: "شركة أ",
    party_two_name: "شركة ب",
    subject: "تقديم خدمات استشارية",
    duration: "سنة واحدة",
    // confidentiality left empty on purpose
  });
  check("formatFields includes a filled recommended field", formatted.includes("سنة واحدة"));
  check("formatFields drops an empty optional field", !formatted.includes("السرية"));
}

// ---------------------------------------------------------------- drafting: sectionHeadingFor / moveSection
console.log("\n[drafting: section-level refine + reorder helpers]");
{
  const testBlocks: DraftBlock[] = [
    { id: "h0", type: "header", text: "محكمة" },
    { id: "intro", type: "body", text: "رقم الدعوى: .../..." },
    { id: "s1", type: "heading", text: "القسم الأول" },
    { id: "b1", type: "body", text: "نص القسم الأول" },
    { id: "s2", type: "heading", text: "القسم الثاني" },
    { id: "b2", type: "body", text: "نص القسم الثاني" },
    { id: "sig", type: "signature", text: "التوقيع" },
  ];
  const idsOf = (blocks: DraftBlock[]) => blocks.map((b) => b.id).join(",");

  check("sectionHeadingFor finds the nearest preceding heading", sectionHeadingFor(testBlocks, "b2") === "القسم الثاني");
  check(
    "sectionHeadingFor returns \"\" for a body block before any heading",
    sectionHeadingFor(testBlocks, "intro") === ""
  );

  const movedDown = moveSection(testBlocks, "s1", "down");
  check(
    "moveSection swaps a section down past its neighbour",
    idsOf(movedDown) === "h0,intro,s2,b2,s1,b1,sig",
    idsOf(movedDown)
  );

  // s1's section is now SECOND (after the swap put s2 first) — moving IT up
  // is what restores the original order, not moving s2 (which is now first,
  // so "up" on it would correctly no-op, not undo anything).
  const movedBack = moveSection(movedDown, "s1", "up");
  check("moveSection swapping back restores original order", idsOf(movedBack) === idsOf(testBlocks));

  check("moveSection no-ops moving the first section up", idsOf(moveSection(testBlocks, "s1", "up")) === idsOf(testBlocks));
  check(
    "moveSection no-ops moving the last section down",
    idsOf(moveSection(testBlocks, "s2", "down")) === idsOf(testBlocks)
  );
  check(
    "moveSection round-trips through blocksToDraft with no data loss",
    blocksToDraft(movedDown).includes("نص القسم الأول") && blocksToDraft(movedDown).includes("نص القسم الثاني")
  );
}

// ----------------------------------------------------------------
console.log(`\n${"=".repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(46)}\n`);
process.exit(failed > 0 ? 1 : 0);
