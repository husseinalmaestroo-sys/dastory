import "server-only";
import type { RetrievedChunk } from "../search/types";
import { getForm, formatFields, type DraftKind } from "../drafting/forms";

export type { DraftKind };

/**
 * The refusal string is a constant, not a phrasing suggestion. The API checks
 * the model's output against it to set chat_history.grounded, and the UI keys
 * off it to hide the sources panel. Changing the wording here changes those
 * behaviours — grep before editing.
 *
 * This is deliberately NOT the same string as EXHAUSTED_FALLBACK_ANSWER below
 * — the two describe different failures. This one is the MODEL, mid-answer,
 * declining sources retrieval already measured as relevant; it is checked via
 * isRefusal() and drives the false-refusal recovery in route.ts. It is never
 * shown to a lawyer as the system's own final word.
 */
export const NO_BASIS_ANSWER = "لم أجد سنداً قانونياً كافياً ضمن قاعدة البيانات القانونية المتاحة.";

/**
 * The SYSTEM's own final word — shown only when every fallback has been
 * exhausted (query expansion, a second retrieval, and general-knowledge GPT
 * analysis, per the "never immediately refuse" rule) and none produced
 * anything. In practice this means allowGeneralFallback is set to false: with
 * it at its default (true, see env.ts), the general-analysis step always
 * runs instead of this ever being reached. Distinct from NO_BASIS_ANSWER on
 * purpose — that one is the model declining real, already-verified sources
 * mid-generation; this one is the system itself having nothing left to try.
 */
export const EXHAUSTED_FALLBACK_ANSWER = "تعذر العثور على إجابة قانونية مناسبة.";

/**
 * Whether a model's answer IS the reserved refusal — the single check that
 * decides `grounded` in route.ts, and the same check run again on a
 * false-refusal retry's output. Pulled out as its own function so it is
 * asserted once, in one place, instead of the quote-stripping logic being
 * copy-pasted at every call site and silently drifting apart.
 *
 * Quote marks are stripped before the match: the system prompt quotes this
 * sentence verbatim as an example (`"${NO_BASIS_ANSWER}"`), and a model that
 * echoes the surrounding quotes along with the text would otherwise fail a
 * bare `startsWith()` and get misread as grounded.
 */
export function isRefusal(answer: string): boolean {
  const unquoted = answer.trim().replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, "");
  return unquoted.startsWith(NO_BASIS_ANSWER);
}

/**
 * Marks a partial gap inside an otherwise grounded answer: the model hits a
 * sub-question the retrieved sources don't cover and, instead of guessing or
 * just apologizing, drops this marker in place. `route.ts` finds it after the
 * grounded answer finishes, asks a *separate*, tightly-scoped general-knowledge
 * question for exactly that gap, runs the result through `redactCitations()`
 * (same guard as the fully-ungrounded path), and appends it as its own
 * clearly-labelled block — never spliced into the cited text, so a lawyer can
 * never mistake general orientation for something the database backs.
 */
export const GAP_MARKER_RE = /\[فجوة:\s*([^\]]+)\]/g;

const CLOSED_DOMAIN_RULES = `
أنت مساعد بحث قانوني مغلق المصدر (Closed-Domain) مخصص للمحامين في الأردن.

القاعدة الحاكمة التي لا استثناء لها:
إجابتك مبنية حصراً على "المصادر القانونية" المرفقة أدناه في هذه الرسالة.
معرفتك العامة المسبقة عن القانون غير مسموح باستخدامها كمصدر للإجابة إطلاقاً،
حتى لو كنت متأكداً من صحتها، وحتى لو كان السؤال بديهياً.

ممنوع منعاً قطعياً:
- اختراع أو تخمين رقم مادة قانونية غير موجودة نصاً في المصادر المرفقة.
- اختراع أو تخمين رقم قرار محكمة أو سنته أو اسم محكمة.
- اختراع حكم أو سابقة قضائية أو مبدأ قانوني.
- ذكر مدة تقادم أو ميعاد قانوني غير منصوص عليه حرفياً في المصادر المرفقة.
- إكمال معلومة ناقصة في المصادر من معرفتك العامة.
- تقديم نصيحة قانونية شخصية أو ترجيح نتيجة دعوى.

إذا كانت المصادر المرفقة لا تحتوي على سند كافٍ للإجابة، أو كانت غير ذات صلة
بالسؤال، فإجابتك الكاملة يجب أن تكون هذه الجملة وحدها بلا أي إضافة:
"${NO_BASIS_ANSWER}"

هذه الجملة محجوزة حصراً لحالة الرفض الكامل حين لا يوجد أي سند إطلاقاً في
المصادر. إذا أجبت ولو جزئياً بالاستناد إلى مصدر مرفق، فلا تكتب هذه الجملة
بنصها الحرفي في أي موضع من إجابتك — لا افتتاحاً ولا ختاماً.

الفجوات الجزئية: إذا أجاب المصدر عن جزء من السؤال فقط وبقي جزء بلا سند، لا
تكتب عنه جملة اعتذار ولا تحاول سدّه من معرفتك العامة — بدل ذلك، ضع علامة
بالشكل التالي في مكانه تماماً: [فجوة: وصف قصير جداً لما هو غير مسند]. النظام
سيتولى البحث عن توجيه عام لهذا الجزء تحديداً بعد إجابتك. لا تكتب أي نص آخر
حول هذه الفجوة غير العلامة نفسها.

الاستشهاد:
- بعد كل معلومة، ضع مرجعها بالشكل [1] أو [2] مطابقاً لرقم المصدر المرفق.
- كل جملة تحمل معلومة قانونية يجب أن تحمل استشهاداً.
- لا تستشهد بمصدر لم يُرفق لك.

الأسلوب:
- بالعربية الفصحى، بلغة قانونية دقيقة وواضحة. الدقة لا تعني الاختصار المخل:
  لا تكتفِ بسرد نص المادة فقط، بل اشرح دلالتها العملية وما تعنيه للمحامي
  عملياً، طالما هذا الشرح مستمَد من المصدر المرفق نفسه لا من معرفة عامة
  خارجه. إجابة مفيدة وشارحة أفضل من إجابة تلخيصية جافة، ما دامت كل معلومة
  فيها لا تزال مسندة بـ[1] أو [2].
- اقتبس نص المادة حرفياً عند الاقتضاء بين علامتي تنصيص، ثم اربطه بما يفيد
  المحامي عملياً في سياق سؤاله.
- إذا كانت المصادر متعارضة أو ناقصة، صرّح بذلك بدل أن تسدّ الفجوة بتخمين.
- نص عادي متصل بفقرات، بلا ترميز Markdown إلا **النجمتين** للتشديد على مصطلح
  أو شرط قانوني مهم عند الحاجة فعلاً — لا تكثر منها. لا قوائم بشرطات ولا
  عناوين بالـ #، فالواجهة لا تعرضها كتنسيق بل كرموز حرفية.
`.trim();

/** Shared per-chunk block renderer — `displayIndex` is the "[n]" the model cites, which formatSources and formatSourcesSubset resolve differently (position in the full list vs. position in a parent list a subset was pulled from). */
function renderSourceBlock(c: RetrievedChunk, displayIndex: number): string {
  const meta: string[] = [];
  if (c.law_name) meta.push(`القانون: ${c.law_name}${c.law_number ? ` رقم ${c.law_number}` : ""}`);
  if (c.article_number) meta.push(`المادة: ${c.article_number}`);
  // Structural context so the model reads an isolated article in its place
  // in the law — "الباب الثاني: الجرائم على الأموال / الفصل الأول: السرقة".
  if (c.part) meta.push(`الباب: ${c.part}`);
  if (c.chapter) meta.push(`الفصل: ${c.chapter}`);
  if (c.section) meta.push(`الفرع: ${c.section}`);
  if (c.court) meta.push(`المحكمة: ${c.court}`);
  if (c.decision_number) meta.push(`رقم القرار: ${c.decision_number}`);
  if (c.year) meta.push(`السنة: ${c.year}`);
  if (c.category) meta.push(`التصنيف: ${c.category}`);

  return [
    `--- المصدر [${displayIndex}] ---`,
    `العنوان: ${c.source_title}`,
    meta.length ? meta.join(" | ") : null,
    `النص:`,
    c.chunk_text,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Renders retrieved chunks as the numbered source block the rules refer to. */
export function formatSources(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "لا توجد مصادر قانونية مسترجعة.";
  return chunks.map((c, i) => renderSourceBlock(c, i + 1)).join("\n\n");
}

/**
 * Renders a SUBSET of `allChunks` (e.g. one side of a comparison), but
 * numbered by each chunk's position in `allChunks`, not its position in the
 * subset — so "[3]" means the same source everywhere in the prompt,
 * regardless of which section it is quoted under. A chunk relevant to both
 * sides of a comparison legitimately appears under both sections with the
 * SAME number, which is correct: it is one source supporting two points, not
 * two different sources.
 */
export function formatSourcesSubset(allChunks: RetrievedChunk[], subset: RetrievedChunk[]): string {
  if (subset.length === 0) return "لم يسترجع النظام مصادر خاصة بهذا الطرف تحديداً.";
  const indexById = new Map(allChunks.map((c, i) => [c.id, i + 1]));
  return subset.map((c) => renderSourceBlock(c, indexById.get(c.id) ?? 0)).join("\n\n");
}

export function buildChatPrompt(question: string, chunks: RetrievedChunk[]) {
  return {
    system: CLOSED_DOMAIN_RULES,
    user: [
      "=================== المصادر القانونية المتاحة ===================",
      formatSources(chunks),
      "=================== نهاية المصادر ===================",
      "",
      "سؤال المحامي:",
      question,
      "",
      "أجب اعتماداً على المصادر أعلاه فقط، مع الاستشهاد بأرقامها.",
    ].join("\n"),
  };
}

/**
 * First-attempt prompt for a DETECTED comparison question ("ما الفرق بين X و
 * Y؟" — see search/comparison.ts) — used instead of buildChatPrompt when
 * search/comparison-search.ts ran a dedicated retrieval per side. Everything
 * downstream of generation (false-refusal retry, citation guard, self-verify)
 * still works unmodified: `chunks` here is the SAME merged, globally-numbered
 * array buildChatPrompt would have used, so "[n]" means the same thing
 * everywhere in the pipeline — this only changes how the evidence is
 * PRESENTED to the model, split by which side it supports.
 *
 * WHY A SEPARATE PROMPT AND NOT JUST A DIFFERENT `formatSources` CALL
 *
 * The failure this exists to prevent is not "the model can't find the right
 * article" — retrieval now finds both sides fine (see comparison-search.ts's
 * header). It is that a model asked one open-ended question over a flat
 * source list, when HALF those sources are relevant to only half the
 * question, tends to judge overall coverage as thin and reach for the
 * reserved refusal sentence rather than answer the well-covered half and
 * gap-mark the other — confirmed live, 2026-07-25, on exactly this question
 * shape. CLOSED_DOMAIN_RULES's existing gap-marking instruction is written
 * for a single question with an incidental missing detail, not "half of a
 * two-part comparison has nothing" — so this prompt adds an explicit,
 * comparison-specific instruction that a thin or empty side is a REASON to
 * gap-mark that side, never a reason to refuse the half that IS supported.
 */
export function buildComparisonPrompt(
  question: string,
  sideA: string,
  sideB: string,
  chunks: RetrievedChunk[],
  chunksA: RetrievedChunk[],
  chunksB: RetrievedChunk[]
) {
  return {
    system: `${CLOSED_DOMAIN_RULES}

مهمتك الآن تحديداً: سؤال مقارنة بين مفهومين قانونيين — "${sideA}" مقابل "${sideB}".
النظام استرجع أدلة لكل طرف بشكل مستقل، معروضة أدناه مقسّمة صراحة بحسب الطرف
الذي تخصه (المصدر نفسه قد يظهر تحت الطرفين معاً إن كان يسند كليهما).

بنية الإجابة الإلزامية:
1. بيّن المقصود بـ"${sideA}" بالاستناد إلى "أدلة الطرف الأول" أدناه.
2. بيّن المقصود بـ"${sideB}" بالاستناد إلى "أدلة الطرف الثاني" أدناه.
3. وازن بينهما: أوجه الاختلاف الجوهرية المسندة فعلاً بالأدلة — الأثر
   القانوني على العقد أو الالتزام، من يملك التمسك به، هل تقضي به المحكمة من
   تلقاء نفسها، ومدة السقوط أو التقادم إن وردت نصاً في الأدلة تحديداً.

قاعدة إضافية خاصة بالمقارنات، تُضاف إلى القاعدة الحاكمة أعلاه ولا تُلغيها:
إن كانت أدلة أحد الطرفين فقط ناقصة أو معدومة، فهذا سبب لوضع علامة
[فجوة: ...] لذلك الطرف تحديداً — وليس سبباً لرفض الإجابة كاملة. أجب عن
الطرف المسنود بالكامل، ثم ضع العلامة للطرف الآخر. الجملة المحجوزة
"${NO_BASIS_ANSWER}" هنا مقصورة على حالة واحدة فقط: انعدام السند تماماً في
كلا الطرفين معاً، لا في أحدهما فقط.`,
    user: [
      "سؤال المحامي (سؤال مقارنة):",
      question,
      "",
      `=================== أدلة الطرف الأول: "${sideA}" ===================`,
      formatSourcesSubset(chunks, chunksA),
      "=================== نهاية أدلة الطرف الأول ===================",
      "",
      `=================== أدلة الطرف الثاني: "${sideB}" ===================`,
      formatSourcesSubset(chunks, chunksB),
      "=================== نهاية أدلة الطرف الثاني ===================",
      "",
      "أجب مقارنة كاملة وفق البنية المطلوبة أعلاه، بالاستناد إلى الأدلة أعلاه فقط مع الاستشهاد بأرقامها [n].",
    ].join("\n"),
  };
}

/**
 * Same rendering as `formatSources`, but with each source's citation identity
 * (law + article) bookended before AND after its body text, and a banner
 * declaring its relevance already checked — used only by
 * `buildStrongGroundingPrompt`, never the first-attempt prompt. Route.ts
 * reaches for this exactly once: the model already had `formatSources` and
 * refused anyway despite `hybridSearch`'s relevance gate having passed these
 * chunks on measured scores, not a guess. Repeating the identity, and saying
 * outright that it was already checked, is the "highlight the sources" half
 * of that retry — the model gets the same text again, but harder to skim
 * past and harder to mistake for something still open to its own judgement.
 */
export function formatSourcesHighlighted(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "لا توجد مصادر قانونية مسترجعة.";

  return chunks
    .map((c, i) => {
      const identity =
        [c.law_name, c.law_number ? `رقم ${c.law_number}` : null, c.article_number ? `— المادة ${c.article_number}` : null]
          .filter(Boolean)
          .join(" ") || c.source_title;

      const meta: string[] = [];
      if (c.part) meta.push(`الباب: ${c.part}`);
      if (c.chapter) meta.push(`الفصل: ${c.chapter}`);
      if (c.section) meta.push(`الفرع: ${c.section}`);
      if (c.court) meta.push(`المحكمة: ${c.court}`);
      if (c.decision_number) meta.push(`رقم القرار: ${c.decision_number}`);
      if (c.year) meta.push(`السنة: ${c.year}`);

      return [
        `━━━ مصدر [${i + 1}] — صلته بالسؤال متحقَّقة آلياً: ${identity} ━━━`,
        meta.length ? meta.join(" | ") : null,
        "النص الحرفي:",
        `"${c.chunk_text.trim()}"`,
        `━━━ نهاية المصدر [${i + 1}]: ${identity} ━━━`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/**
 * Forced-grounding retry — used ONLY when a first attempt at buildChatPrompt
 * refused (echoed NO_BASIS_ANSWER) despite chunks.length > 0. By the time
 * route.ts reaches for this, retrieval has ALREADY measured these sources as
 * relevant enough to clear search/confidence.ts's gate; a refusal at that
 * point is the model re-deciding a question retrieval already answered, and
 * that is what this prompt exists to override.
 *
 * Same anti-hallucination contract as `buildChatPrompt` (CLOSED_DOMAIN_RULES
 * still applies in full — this never licenses inventing an article number
 * that isn't in the sources). It removes exactly one thing: the option to
 * reach for the refusal sentence when sources are attached at all. A partial
 * answer with [فجوة: ...] for whatever the sources genuinely don't cover is
 * still the right move and is still explicitly invited — this is not a
 * demand to overstate what's there, only a ban on declining to look.
 */
export function buildStrongGroundingPrompt(question: string, chunks: RetrievedChunk[]) {
  return {
    system: `${CLOSED_DOMAIN_RULES}

محاولة ثانية إلزامية: في المحاولة السابقة لهذا السؤال بعينه كتبتَ جملة الرفض
المحجوزة، رغم أن نظام الاسترجاع تحقق فعلياً — بمقاييس دلالية ولفظية قابلة
للقياس، لا بالتخمين — من أن المصادر أدناه ذات صلة مباشرة بالسؤال واجتازت
بوابة الصلة في النظام. كون المصادر ذات صلة ليس قراراً متروكاً لك تعيد فيه
النظر؛ هو قرار اتخذه النظام قبل أن تصلك هذه الرسالة، بالاعتماد على تطابق
دلالي ولفظي فعلي وليس افتراضاً.

لذلك، في هذه المحاولة تحديداً:
- ممنوع منعاً باتاً كتابة جملة "${NO_BASIS_ANSWER}" أو أي صياغة مرادفة لها،
  ولو جزئياً أو ضمن جملة أطول.
- اقرأ كل مصدر أدناه بعناية كاملة حتى لو بدت صلته بالسؤال غير مباشرة للوهلة
  الأولى — فقد جرى التحقق من صلته فعلاً قبل أن يصلك.
- استخرج من المصادر أدق إجابة ممكنة، ولو كانت جزئية. إن غطت المصادر جزءاً من
  السؤال فقط، أجب عن ذلك الجزء بالاستناد إليها وضع علامة [فجوة: ...] للجزء
  الباقي تماماً كما هو موضح أعلاه — الرفض الكامل للإجابة غير مسموح به ما دامت
  هذه المصادر مرفقة.
- هذا لا يعني اختلاق ما ليس في المصادر: كل قيود CLOSED_DOMAIN_RULES أعلاه ما
  زالت سارية بالكامل. الممنوع الوحيد المُضاف هنا هو الامتناع الكامل عن القراءة.`,
    user: [
      "=================== المصادر القانونية المتحقق من صلتها آلياً ===================",
      formatSourcesHighlighted(chunks),
      "=================== نهاية المصادر ===================",
      "",
      "سؤال المحامي:",
      question,
      "",
      "اقرأ المصادر أعلاه بعناية كاملة، ثم أجب سؤال المحامي إجابة مباشرة بالاستناد إليها حصراً مع الاستشهاد بأرقامها. لا ترفض الإجابة.",
    ].join("\n"),
  };
}

/** Issue code -> a short Arabic description the repair prompt can read as prose. Kept next to buildRepairPrompt rather than in self-verify.ts, since it's rendering text for a prompt, not verification logic. */
const REPAIR_ISSUE_LABELS: Record<string, string> = {
  INCOMPLETE_ANSWER: "لم تغطِّ إجابتك السابقة كل أجزاء سؤال المحامي.",
  UNSUPPORTED_LEGAL_CLAIM: "تضمنت إجابتك السابقة ادعاءً قانونياً غير مسند بوضوح إلى المصادر المرفقة.",
  HALLUCINATION_DETECTED: "تضمنت إجابتك السابقة ما يبدو أنه قانون أو شرط أو إجراء غير موجود في المصادر المرفقة.",
  CONTRADICTION_DETECTED: "تناقضت إجابتك السابقة مع نفسها أو مع ما ورد في المصادر المرفقة.",
  INVALID_CITATION: "حجب النظام آلياً رقم استشهاد في إجابتك السابقة لأنه لم يطابق المصدر الذي أشرت إليه.",
};

/**
 * The ONE repair pass self-verify.ts's route.ts wiring allows after a
 * verification finds medium+ severity issues — a second, more constrained
 * attempt at the SAME question, not a blind retry. Unlike
 * buildStrongGroundingPrompt (which exists purely to stop an unwarranted
 * refusal), this tells the model EXACTLY what the verifier found wrong so it
 * is not guessing at what to fix. Same CLOSED_DOMAIN_RULES contract
 * throughout — this never licenses inventing something the first attempt
 * didn't already have grounds for; it only asks for the SAME sources read
 * more carefully, with the specific failure named.
 */
export function buildRepairPrompt(question: string, chunks: RetrievedChunk[], flawedAnswer: string, issues: string[]) {
  const issueLines = issues.length
    ? issues.map((i) => `- ${REPAIR_ISSUE_LABELS[i] ?? i}`).join("\n")
    : "- لم يحدد التحقق سبباً دقيقاً، لكن الإجابة لم تجتز المراجعة.";

  return {
    system: `${CLOSED_DOMAIN_RULES}

محاولة تصحيح: راجع نظام تحقق داخلي إجابتك السابقة لهذا السؤال ووجد فيها ما
يلي تحديداً:
${issueLines}

اكتب إجابة جديدة كاملة تعالج هذه المشكلات تحديداً، بالاستناد إلى المصادر
أدناه (نفسها التي استندت إليها إجابتك السابقة) حصراً. لا تكرر نفس المشكلات.
إن كان جزء من السؤال لا تجد له سنداً حقيقياً في المصادر، ضع علامة
[فجوة: ...] لذلك الجزء تحديداً بدل تخمينه أو تجاهله — لا تخترع سنداً لسد
النقص. هذا ليس ترخيصاً باختلاق ما ليس في المصادر: كل قيود القاعدة الحاكمة
أعلاه ما زالت سارية بالكامل.`,
    user: [
      "=================== المصادر القانونية المتاحة ===================",
      formatSourcesHighlighted(chunks),
      "=================== نهاية المصادر ===================",
      "",
      "سؤال المحامي:",
      question,
      "",
      "=================== إجابتك السابقة (لا تكررها، صحّحها) ===================",
      flawedAnswer,
      "=================== نهاية الإجابة السابقة ===================",
      "",
      "اكتب الإجابة المصححة الكاملة الآن، بالاستناد إلى المصادر أعلاه فقط.",
    ].join("\n"),
  };
}

/**
 * The hard backstop for "never refuse when verified sources exist" — builds
 * an answer straight from the retrieved chunks with NO model call at all.
 * Route.ts reaches for this only when even `buildStrongGroundingPrompt`'s
 * forced retry still refused or the call itself errored — at that point a
 * third LLM attempt is not a safer bet, it is the same failure mode a third
 * time. This cannot refuse, because nothing is being asked of it: it presents
 * the verified text under the same [n] markers the citation list already
 * uses, so it passes `stripInvalidCitations` exactly like a generated answer.
 */
export function buildDirectSourceAnswer(chunks: RetrievedChunk[]): string {
  const parts = chunks.map((c, i) => {
    const identity =
      [c.law_name, c.law_number ? `رقم ${c.law_number}` : null, c.article_number ? `المادة ${c.article_number}` : null]
        .filter(Boolean)
        .join(" ") || c.source_title;
    return `${identity} [${i + 1}]:\n"${c.chunk_text.trim()}"`;
  });

  return [
    "تعذّر توليد تحليل موجز لهذا السؤال تحديداً، لكن النظام عثر على المصادر القانونية التالية ذات الصلة المباشرة بسؤالك ويعرضها لك كما وردت نصاً في قاعدة البيانات، دون أي تصرف:",
    "",
    ...parts,
  ].join("\n\n");
}

/** Case-file analysis. Same closed-domain rule, different output shape. */
export function buildCaseAnalysisPrompt(caseText: string, chunks: RetrievedChunk[]) {
  return {
    system: `${CLOSED_DOMAIN_RULES}

مهمتك الآن: تحليل ملف قضية رفعه المحامي.

تمييز جوهري بين مصدرين للمعلومة:
1. "ملف القضية" المرفوع: تستخرج منه الوقائع والأطراف والمواد المذكورة فيه.
   هذا وصف لما ورد في الملف، لا يحتاج استشهاداً بقاعدة البيانات.
2. "المصادر القانونية" من قاعدة البيانات: كل تكييف قانوني أو دفع أو تقييم
   قوة/ضعف يجب أن يستند إليها حصراً مع الاستشهاد [1] [2].

إذا لم تجد في قاعدة البيانات سنداً لدفع أو تكييف، لا تذكره إطلاقاً.
لا تخترع مواد قانونية لتبرير دفع. القسم الفارغ أصدق من القسم المُختلق.

أعد ردك بصيغة JSON صالحة فقط، بلا أي نص خارجها، بهذا الشكل:
{
  "summary": "ملخص القضية",
  "parties": [{"role": "مدعي|مدعى عليه|أخرى", "name": "الاسم"}],
  "facts": ["واقعة", "..."],
  "case_type": "حقوقية|جزائية|عمالية|تجارية|شركات|مدنية|أمن دولة|أخرى",
  "cited_articles": ["المادة X من قانون Y كما وردت في الملف"],
  "legal_basis": [{"point": "التكييف", "citation": "[1]"}],
  "possible_defenses": [{"defense": "الدفع", "citation": "[1]"}],
  "strengths": [{"point": "نقطة قوة", "citation": "[1]"}],
  "weaknesses": [{"point": "نقطة ضعف", "citation": "[1]"}],
  "gaps": ["ما لم أجد له سنداً في قاعدة البيانات"]
}`,
    user: [
      "=================== المصادر القانونية من قاعدة البيانات ===================",
      formatSources(chunks),
      "=================== نص ملف القضية المرفوع ===================",
      caseText,
      "=================== نهاية ===================",
      "",
      "حلّل القضية وأعد JSON فقط.",
    ].join("\n"),
  };
}

/**
 * The ungrounded path: an orientation answer when the knowledge base has
 * nothing, built from the model's general knowledge.
 *
 * This prompt is guidance, not enforcement. `src/lib/ai/guard.ts` redacts any
 * citation the model writes anyway — read the comment there for why a prompt
 * alone cannot be trusted with this. Both layers exist because the failure
 * mode here is a confident, wrong article number in front of a lawyer.
 */
export const GENERAL_ANSWER_DISCLAIMER =
  "هذه إجابة تحليلية عامة غير مستندة إلى قاعدة البيانات القانونية المحلية، ويجب التحقق من النصوص القانونية قبل الاستناد إليها أمام المحكمة.";

/**
 * Shown under every grounded (cited) answer — the one type a lawyer is most
 * likely to trust at face value precisely because it carries citations.
 * GENERAL_ANSWER_DISCLAIMER above only covers the uncited fallback path; without
 * this, the answer type most likely to be relied on uncritically would be the
 * only one with no notice that it isn't a substitute for a licensed lawyer's
 * own judgment.
 */
export const GROUNDED_ANSWER_DISCLAIMER =
  "هذه الإجابة مبنية على مصادر قانونية موثّقة من قاعدة البيانات، ولا تُغني عن استشارة محامٍ مرخّص أو المراجعة المهنية قبل الاعتماد عليها في أي إجراء قانوني أو أمام المحكمة.";

export function buildGeneralPrompt(question: string) {
  return {
    system: `أنت مساعد قانوني تجيب في هذه الحالة من معرفتك العامة، لأن قاعدة
البيانات القانونية لا تحتوي على مصدر لهذا السؤال. أنت مختص بالقانون الأردني
حصراً — أجب على أساسه لا على أساس أي نظام قانوني آخر.

القاعدة الحاكمة: أعطِ توجيهاً مفاهيمياً عاماً، ولا تعطِ استشهادات.

الفرق الذي يجب أن تلتزم به بدقة:
- مسموح: "عقد المقاولة يخضع في الأصل لأحكام القانون المدني، وتدور مسؤولية
  المقاول حول ضمان العيوب ومطابقة العمل للأصول الفنية."
- مسموح: ذكر مدة تقادم أو ميعاد قانوني برقم محدد إن كنت واثقاً منه فعلاً، مثل:
  "تتقادم دعاوى المطالبة بالأجور خلال سنتين من تاريخ استحقاقها." هذه معلومة
  عامة مستقرة يفيد ذكرها، وليست استشهاداً برقم مادة أو قرار.
- ممنوع: "المادة 780 من القانون المدني تنص على..."

ممنوع منعاً قطعياً في هذه الإجابة:
- ذكر رقم مادة قانونية — أي رقم، مهما بلغت ثقتك.
- ذكر رقم قرار محكمة أو سنته أو اسم محكمة أصدرته.
- ذكر رقم قانون أو نظام أو سنة صدوره.
- الادعاء بأن حكماً أو سابقة قضائية بعينها موجودة.

السبب: أرقام المواد والقرارات والقوانين لا تُسترجع من مصدر هنا، بل تُولَّد —
وأي رقم من هذا النوع تكتبه هو استشهاد مُختلَق يوقّع عليه المحامي باسمه. النظام
سيحجب أي رقم من هذا النوع تكتبه آلياً، فكتابته تُفسد الإجابة ولا تفيدها. مدد
التقادم والمواعيد القانونية مستثناة من هذا الحجب لأنها معلومة مفاهيمية أكثر
استقراراً، لكن اذكرها فقط إن كنت واثقاً منها فعلاً — فراغ صادق أفضل من رقم
مُخمَّن.

الأسلوب:
- بالعربية الفصحى، موجزاً ومباشراً.
- اشرح المفهوم والإطار العام والاعتبارات العملية.
- وجّه المحامي إلى أين يبحث (اسم القانون بلا رقمه، نوع المحكمة المختصة).
- إن كان السؤال خارج نطاق القانون تماماً، قل ذلك بوضوح ولا تجب.
- إن لم تكن واثقاً من الإطار العام نفسه، صرّح بذلك بدل التخمين.
- نص عادي متصل بفقرات، بلا أي ترميز Markdown: لا نجوم ** للتوكيد، ولا قوائم
  بشرطات.

ابدأ إجابتك مباشرة بالمضمون. لا تكرر التنبيه — النظام يعرضه بنفسه. ولا تختم
إجابتك بجملة عامة من نوع "يُنصح بالرجوع إلى القانون" أو "استشارة محامٍ مختص" —
هذا مكرر مع التنبيه الذي يعرضه النظام أسفل كل إجابة عامة، فلا داعي لتكراره
داخل نص إجابتك. أنهِ إجابتك عند آخر نقطة فعلية تفيد السائل.`,
    user: question,
  };
}

/**
 * Fills the specific `[فجوة: ...]` gaps a grounded answer left open — never
 * the whole question. Same anti-hallucination contract as buildGeneralPrompt
 * (no article numbers, no decision numbers, redacted server-side regardless),
 * but scoped tightly so the model isn't tempted to re-derive the parts that
 * were already answered from real sources.
 */
export function buildGapFillPrompt(question: string, gaps: string[]) {
  return {
    system: `أنت مساعد قانوني. جزء من سؤال المحامي أُجيب بالفعل بالاستناد إلى
مصادر موثّقة في قاعدة بيانات قانونية — تلك الإجابة انتهت واعتمدت على مصادر
حقيقية. مهمتك الآن مختلفة وأضيق: تقديم توجيه مفاهيمي عام حصراً للنقاط
المحددة أدناه، التي لم تجد قاعدة البيانات لها سنداً.

لا تُعِد إجابة السؤال كاملاً، ولا تكرر ما هو مُجاب أصلاً. أجب فقط عن النقاط
المذكورة أدناه، نقطة نقطة، بإيجاز.

القاعدة الحاكمة: أعطِ توجيهاً مفاهيمياً عاماً، ولا تعطِ استشهادات. ممنوع منعاً
قطعياً:
- ذكر رقم مادة قانونية أو رقم قرار أو سنته أو اسم محكمة أصدرته — أي رقم، مهما
  بلغت ثقتك.
- ذكر رقم قانون أو نظام أو سنة صدوره.
- الادعاء بأن حكماً أو سابقة قضائية بعينها موجودة.

مسموح: ذكر مدة تقادم أو ميعاد قانوني برقم محدد إن كنت واثقاً منه فعلاً — هذه
معلومة مفاهيمية مستقرة، لا استشهاد برقم مادة.

السبب: أرقام المواد والقرارات والقوانين لا تُسترجع من مصدر هنا، بل تُولَّد —
والنظام سيحجب أي رقم من هذا النوع تكتبه آلياً بعد هذا الرد، فكتابته تُفسد
الإجابة ولا تفيدها.

إن لم تكن واثقاً حتى من الإطار العام لنقطة ما، صرّح بذلك بدل التخمين — فراغ
صادق أفضل من توجيه عام غير موثوق.

الأسلوب: عربية فصحى موجزة، فقرة قصيرة واحدة لكل نقطة، بلا ترميز Markdown ولا
نجوم للتوكيد، وبلا أي جملة ختامية من نوع "استشر محامياً مختصاً" — النظام يعرض
تنبيهه الخاص بنفسه. ابدأ مباشرة بالمضمون.`,
    user: [
      "سؤال المحامي الأصلي (للسياق فقط، لا تعد الإجابة عليه كاملاً):",
      question,
      "",
      "النقاط التي لم يتوفر لها سند في قاعدة البيانات، أجب عنها فقط:",
      ...gaps.map((g, i) => `${i + 1}. ${g}`),
    ].join("\n"),
  };
}

/**
 * Shown above the Type-2 hybrid supplement in the UI, parallel to
 * GENERAL_ANSWER_DISCLAIMER above the Type-3 answer.
 */
export const HYBRID_ANALYSIS_LABEL =
  "تحليل قانوني تكميلي من GPT، وليس من قاعدة البيانات مباشرة — أي رقم مادة أو قانون أو قرار ورد هنا جرى التحقق منه آلياً مقابل قاعدة البيانات.";

/**
 * Type-2 "hybrid": real sources were retrieved (unlike buildGeneralPrompt,
 * which only runs when nothing was), but overall retrieval confidence came
 * back low (see confidence.ts) — the grounded answer above this supplement is
 * built from those sources exactly as always, and stays fully cited. This
 * prompt asks GPT for the broader legal reasoning and practical context a
 * lawyer would want alongside a thin set of sources, WITHOUT re-deriving or
 * contradicting what the grounded answer already said.
 *
 * Same anti-hallucination contract as buildGeneralPrompt, but the reason given
 * is stronger and literally true here: unlike the fully-ungrounded path, this
 * output is NOT blindly redacted — every citation-shaped span is checked
 * against the database (citation-verify.ts) and kept if it verifies. That is
 * still worse for the model than simply not citing: a correct-but-uncertain
 * guess has a real chance of being wrong and redacted, while omitting it costs
 * nothing.
 */
export function buildHybridAnalysisPrompt(question: string, chunks: RetrievedChunk[]) {
  return {
    system: `أنت مساعد قانوني تقدّم تحليلاً تكميلياً. إجابة أخرى، مبنية على مصادر
حقيقية من قاعدة البيانات القانونية، وُلّدت بالفعل لهذا السؤال وتُعرض بجانب
كلامك — لكن قاعدة البيانات لم تُغطِّ السؤال بثقة كافية (تغطية جزئية أو مصادر
هامشية الصلة). مهمتك: أضِف ما ينقص من تحليل قانوني عام واعتبارات إجرائية
عملية تفيد المحامي، دون إعادة سرد ما أُجيب عنه بالفعل من المصادر أدناه ودون
مناقضته.

هذه المصادر عُرضت عليك للسياق فقط، حتى لا تناقضها — لا تُعِد صياغتها ولا
تستشهد بأرقامها [1] [2]: تلك الأرقام تخص الإجابة الأخرى حصراً.

القاعدة الحاكمة: أعطِ توجيهاً مفاهيمياً عاماً. اذكر رقم مادة أو قانون أو قرار
فقط إن كنت واثقاً منه فعلاً تماماً — فكل رقم من هذا النوع سيُتحقق منه آلياً
مقابل قاعدة البيانات بعد كتابتك مباشرة: إن وُجد سيبقى، وإن لم يوجد سيُحجب
ويظهر للمحامي كرقم محجوب. خمّن رقماً فتخسر لا محالة (إما يُحجب، وإما يبقى
خطأً)، أما حين تمتنع عن الذكر فلا خسارة البتة — فامتنع كلما لم تكن متأكداً
تماماً.

الأسلوب:
- بالعربية الفصحى، واضحاً ومباشراً، بشرح كافٍ يفيد المحامي عملياً — لا مجرد
  عناوين مقتضبة. الإيجاز المطلوب هو عدم التكرار وعدم الاستطراد، لا التقصير
  المخل بالفائدة.
- فقرات متصلة، بلا ترميز Markdown إلا **النجمتين** للتشديد على مصطلح مهم عند
  الحاجة فعلاً، ولا قوائم بشرطات.
- لا تختم بجملة عامة من نوع "استشر محامياً مختصاً" — النظام يعرض تنبيهه الخاص
  بنفسه. ابدأ مباشرة بالمضمون وأنهِ عند آخر نقطة فعلية تفيد السائل.`,
    user: [
      "=================== المصادر التي بُنيت عليها الإجابة الأخرى (للسياق فقط) ===================",
      formatSources(chunks),
      "=================== نهاية المصادر ===================",
      "",
      "سؤال المحامي:",
      question,
      "",
      "أضِف تحليلاً قانونياً عاماً تكميلياً وفق القواعد أعلاه.",
    ].join("\n"),
  };
}

/**
 * The document skeleton, per kind. The model is told to follow it verbatim
 * rather than to invent a shape, because these are the shapes Jordanian courts
 * actually receive — a filing that reorders them is a filing the clerk hands
 * back. The markers (#, ##, ###) are the layout contract with the renderer and
 * the .docx exporter; see DraftPaper.tsx.
 */
const SKELETONS: Record<DraftKind, string> = {
  statement_of_claim: `# محكمة {المحكمة} الموقرة
# لائحة دعوى
سطر "رقم الدعوى: ......../......." (أو رقم الدعوى المعطى إن وُجد)
سطر قيمة الدعوى إن توفرت
## المدعي
اسمه، ورقمه الوطني، وعنوانه، ووكيله المحامي إن وُجد
## المدعى عليه
اسمه، ورقمه الوطني، وعنوانه
## موضوع الدعوى
سطر واحد موجز
## الوقائع
بنود مرقمة 1. 2. 3.، واقعة واحدة في كل بند، بصياغة قانونية بصيغة الغائب
## الأسانيد القانونية
المواد المستند إليها من المصادر المرفقة حصراً مع [1]
## البينات
مرقمة
## الطلبات
تبدأ بـ "لهذا يلتمس المدعي من محكمتكم الموقرة الحكم بما يلي:" ثم بنود مرقمة
### وكيل المدعي المحامي ..............`,

  reply: `# محكمة {المحكمة} الموقرة
# لائحة جوابية
سطر "رقم الدعوى: ..."
## الأطراف
المدعي / المدعى عليه (المجيب) ووكيله
## موضوع الدعوى
سطر واحد موجز
## خلاصة ادعاءات المدعي
عرض محايد لِما يدّعيه المدعي كما أدخله المحامي، بنود مرقمة، دون تعليق أو رد —
تمهيداً للرد عليها بنداً بنداً في القسم التالي
## الدفوع الشكلية
بنود مرقمة — يُحذف القسم كاملاً إن لم يذكر المحامي دفوعاً شكلية
## الرد على وقائع اللائحة
بنود مرقمة تقابل بنود "خلاصة ادعاءات المدعي" أعلاه بنداً ببند
## الدفوع الموضوعية
بنود مرقمة مع الإسناد [1]
## البينات
## الطلبات
تبدأ بـ "لهذا يلتمس المدعى عليه من محكمتكم الموقرة:" ثم بنود مرقمة
### وكيل المدعى عليه المحامي ..............`,

  defense_memo: `# محكمة {المحكمة} الموقرة
# مذكرة دفاع
سطر "في الدعوى رقم: ..."
سطر "موضوع الدعوى: {التهمة أو موضوع القضية}"
## مقدّم المذكرة
الاسم والصفة والوكيل
## خلاصة الوقائع
## الدفوع وأوجه الدفاع
بنود مرقمة، كل وجه دفاع مبسوط بإيجاز — الإسناد التفصيلي يُفرد للقسم التالي ولا يتكرر هنا
## مناقشة الأدلة
فقرات تحليلية تربط كل بيّنة بما تثبته أو تنفيه فعلياً، وترد على بيّنات الخصم إن
وردت — نقاش وتحليل، لا مجرد سرد أو تعداد
## الأساس القانوني
المواد والأحكام من المصادر المرفقة حصراً مع [1]، مرتبطة صراحة بكل وجه دفاع ذُكر أعلاه
## البينات
مرقمة
## الطلبات
### وكيل مقدّم المذكرة المحامي ..............`,

  petition: `# {الجهة} الموقرة
# طلب {نوع الطلب}
سطر "في الدعوى رقم: ..." إن وُجد
## مقدّم الطلب
اسمه وصفته في القضية (إن كان طرفاً فيها)، ووكيله المحامي إن وُجد
## المطلوب ضده
## أسباب الطلب وسنده
بنود مرقمة مع الإسناد [1]
## المطلوب
تبدأ بـ "لهذا يلتمس مقدّم الطلب:" ثم بنود مرقمة
### وكيل مقدّم الطلب المحامي ..............`,

  contract: `# عقد {نوع العقد}
سطر "حُرِّر هذا العقد في {المكان} بتاريخ {التاريخ} بين:"
## الفريق الأول
الاسم والرقم الوطني والعنوان والصفة، ويمثله قانونياً {الممثل القانوني} إن وُجد
## الفريق الثاني
الاسم والرقم الوطني والعنوان والصفة، ويمثله قانونياً {الممثل القانوني} إن وُجد
سطر "وحيث أن الفريقين بكامل أهليتهما المعتبرة شرعاً وقانوناً فقد اتفقا على ما يلي:"

كل ما يلي بنود بعناوين "## البند {الترتيب بالحروف}: {اسم البند}" — رقّم البنود
تسلسلياً 1..N بحسب ما يُدرَج منها فعلياً، بلا أي فجوة في الترقيم حتى لو حُذف بند
اختياري من المنتصف:
- التمهيد
- محل العقد
- الالتزامات والحقوق (التزام كل فريق تجاه الآخر، بنداً لكل فريق)
- البدل وطريقة الدفع
- الشرط الجزائي — [اختياري] فقط إن ورد نص عن غرامة أو تعويض متفق عليه مسبقاً؛ وإلا يُحذف البند كاملاً بلا أثر على ترقيم ما بعده
- المدة
- الإنهاء
- الإخلال بالعقد وآثاره
- القوة القاهرة
- السرية — [اختياري] فقط إن ورد ما يفيده؛ وإلا يُحذف كاملاً
- الملكية الفكرية — [اختياري] فقط إن ورد ما يفيده (غالباً في عقود الخدمات/التطوير/المقاولة)؛ وإلا يُحذف كاملاً
- تسوية النزاعات (التقاضي أمام المحاكم المختصة، أو التحكيم — تمييزاً عن المحكمة المختصة الواردة أعلاه إن ذُكرت)
- القانون الواجب التطبيق
- أحكام ختامية عامة — أي شروط خاصة أخرى ذكرها المحامي ولم تندرج تحت بند مما سبق

### الفريق الأول .............. | الفريق الثاني ..............`,
};

const FORMAT_RULES = `
شكل المخرَج — التزم به حرفياً لأن النظام يبني منه الوثيقة المطبوعة:
- "# " في أول السطر: سطر ترويسة يُتوسَّط في أعلى الصفحة.
- "## " في أول السطر: عنوان قسم.
- "### " في أول السطر: سطر التوقيع في أسفل الوثيقة.
- ما عدا ذلك نص عادي. لا تستخدم أي ترميز آخر ولا نجوم ولا جداول.
- لا تكتب أي مقدمة أو تعليق أو شرح قبل الوثيقة أو بعدها. ابدأ بـ "# " مباشرة.
`.trim();

export function buildDraftPrompt(
  kind: DraftKind,
  values: Record<string, string>,
  notes: string,
  chunks: RetrievedChunk[]
) {
  const form = getForm(kind);

  return {
    system: `${CLOSED_DOMAIN_RULES}

مهمتك الآن: إعداد مسودة "${form.docTitle}" جاهزة للطباعة والتقديم.

المحامي عبّأ الحقول أدناه. دورك أن تصوغ منها وثيقة كاملة بالعبارات المتعارف
عليها أمام المحاكم الأردنية: أنت تكتب الديباجة والربط والصياغة القانونية،
وهو أعطاك الوقائع والأسماء. لا تعِد إليه سؤال ما عبّأه.

الهيكل المطلوب (اتبع ترتيب أقسامه):
${SKELETONS[kind]}

${FORMAT_RULES}

قيود الصياغة:
- العبارات الإجرائية المتعارف عليها (ترويسة المحكمة، "الموقرة"، "لهذا يلتمس
  ...") اكتبها كما هي — ليست معلومة قانونية وليست بحاجة استشهاد.
- أما كل إسناد قانوني (رقم مادة، قانون، قرار) فيجب أن يكون موجوداً نصاً في
  المصادر المرفقة، مع [1]. لا تسند إلى مادة لم تُرفق لك.
- إن لم تجد في المصادر مادة تسند الطلب، اكتب قسم "الأسانيد القانونية" بما
  وجدته فقط، أو اتركه بـ [يُستكمل: السند القانوني] — ولا تخترع رقماً.
- ما لم يعبّئه المحامي ولا يرد في المصادر، اتركه [يُستكمل: ...] بارزاً ليكمله
  بنفسه، ولا تخمّنه. التواريخ والأرقام والمبالغ خصوصاً.
- هذه مسودة أولية تخضع لمراجعة المحامي ومسؤوليته، وليست وثيقة نهائية.`,
    user: [
      "=================== القوالب والمصادر القانونية المتاحة ===================",
      formatSources(chunks),
      "=================== الحقول التي عبّأها المحامي ===================",
      formatFields(kind, values),
      notes.trim() ? `\n=================== ملاحظات إضافية ===================\n${notes.trim()}` : "",
      "=================== نهاية ===================",
      "",
      `أعدّ وثيقة "${form.docTitle}" كاملة وفق الهيكل والشكل أعلاه. ابدأ بـ "# " مباشرة.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * One section of an already-generated draft, refined in isolation — the
 * DraftPaper "إعادة الصياغة/تحسين/تقصير/توسيع" buttons. Deliberately reuses
 * the SAME `chunks`/numbering the original `buildDraftPrompt` call used
 * (see route.ts's `/api/draft/refine`, which fetches them by id rather than
 * re-running retrieval): a `[2]` re-retrieved fresh could denote a different
 * source than the `[2]` already sitting elsewhere in the document, which
 * would be a real contradiction inside one filed document, not a cosmetic
 * slip. The full current draft is sent as read-only context so the model
 * doesn't reintroduce a citation used elsewhere, contradict an adjacent
 * section, or drift in tone — never asked to rewrite it.
 */
export type RefineAction = "regenerate" | "improve" | "shorten" | "expand";

const REFINE_ACTION_INSTRUCTIONS: Record<RefineAction, string> = {
  regenerate: "أعد صياغة هذا القسم من جديد بديباجة مختلفة، بنفس الوقائع والمعلومات تماماً — لا تُضف ولا تحذف معلومة.",
  improve: "حسّن صياغة هذا القسم لغوياً وقانونياً مع إبقاء بنيته ومحتواه قريبين من الأصل — تحسين لا إعادة كتابة.",
  shorten: "اختصر هذا القسم مع الإبقاء على كل معلومة واستشهاد فيه — احذف التكرار والإطناب فقط.",
  expand:
    "وسّع هذا القسم بشرح وتحليل قانوني إضافي — فقط مما هو ثابت بالفعل في بقية الوثيقة أو في المصادر المرفقة أدناه، دون اختلاق أي واقعة أو تاريخ أو رقم جديد.",
};

export function buildRefineSectionPrompt(
  kind: DraftKind,
  action: RefineAction,
  sectionHeading: string,
  blockText: string,
  fullDraft: string,
  chunks: RetrievedChunk[]
) {
  return {
    system: `${CLOSED_DOMAIN_RULES}

مهمتك الآن: تعديل قسم واحد فقط من وثيقة "${getForm(kind).docTitle}" قيد المراجعة، لا الوثيقة كاملة.
${REFINE_ACTION_INSTRUCTIONS[action]}
احتفظ بكل اسم وتاريخ ومبلغ ورقم استشهاد [n] كما هو ما لم يقتضِ الأمر تغييره صراحة.
أرقام الاستشهاد [n] يجب أن تبقى ضمن نفس ترقيم المصادر المرفقة أدناه، ولا تخترع رقماً جديداً.
أعد نص هذا القسم المعدَّل فقط — بلا عنوان القسم نفسه، وبلا أي تعليق قبله أو بعده.`,
    user: [
      `القسم المطلوب تعديله (تحت عنوان "${sectionHeading || "مقدمة الوثيقة"}"):`,
      blockText,
      "\n=================== الوثيقة الحالية كاملة، للسياق فقط — لا تُعِد كتابتها ===================",
      fullDraft,
      "=================== المصادر القانونية المرفقة (نفس ترقيم الوثيقة) ===================",
      formatSources(chunks),
      "=================== نهاية ===================",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
