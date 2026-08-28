import "server-only";
import { foldForSearch } from "../ingest/clean";
import { containsTerm } from "../ingest/legal-topics";
import { parseIntent } from "./intent";
import { getChatProvider } from "../ai";
import { env } from "../env";

/**
 * Query understanding — the layer BEFORE search.
 *
 * intent.ts already pulls citation targets (article/decision numbers, court,
 * year) out of a question and decides lookup-vs-concept. This goes further: it
 * classifies WHAT KIND of legal question it is, and what area/law/concepts it
 * touches, so the rest of the pipeline can treat "ما المادة 421؟" (a precise
 * lookup) and "شخص أخذ مالاً وقال إنه قرض" (a fact pattern needing the lay-term
 * ↔ statutory-term bridge) completely differently.
 *
 * TWO TIERS, and the order is the whole point:
 *   1. Rules — synchronous, free, deterministic. They resolve the clear cases
 *      (an article number present, a drafting imperative, "ما الفرق بين…") with
 *      NO network call, so a simple question adds zero latency.
 *   2. LLM fallback — one small gpt-4o-mini call, awaited ONLY when the rules
 *      are not confident. Most questions never reach it.
 *
 * So latency scales with ambiguity, not with every request.
 */

export type QueryType =
  | "article_lookup" // ما المادة 421؟
  | "legal_definition" // ما معنى إساءة الائتمان؟
  | "doctrinal_question" // ما الفرق بين القرض والأمانة؟
  | "fact_pattern" // شخص أخذ مالاً وقال إنه قرض
  | "drafting_request" // اكتب لائحة دعوى
  | "contract_review"; // راجع هذا العقد

export type QueryAnalysis = {
  queryType: QueryType;
  /** جزائي | مدني | تجاري | عمالي | شركات | أحوال شخصية | إجرائي | null */
  legalArea: string | null;
  /** The law most likely to answer, e.g. "قانون التجارة". */
  expectedLaw: string | null;
  /** Recognised legal concepts, e.g. ["إساءة الائتمان", "الأمانة"]. */
  legalConcepts: string[];
  /** Significant query terms for the keyword arm / expansion. */
  keywords: string[];
  /**
   * Whether retrieval should expand the query (lay wording ↔ statutory terms).
   * True for the two types where the semantic gap actually bites.
   */
  needsExpansion: boolean;
  /** Provenance: did the LLM fallback run, or did rules alone decide? */
  method: "rules" | "llm";
  /** Rules confidence 0..1 — below THRESHOLD triggers the LLM fallback. */
  confidence: number;
};

// ------------------------------------------------------------------ patterns

const ARTICLE_Q = /(?:ال)?ماد[ةه]\s*[({[]?\s*\d/;

// NOTE: no `\b` in any of these — JS word boundaries are defined against
// [A-Za-z0-9_] and never match beside an Arabic letter, so `اكتب\b` is dead.
// Where an end-of-token guard is needed, use `(?![؀-ۿ])`.
const DRAFT_VERB = /(?:^|\s)(?:اكتب|أكتب|اعد|أعد|أعدّ|صغ|صِغ|صياغة|جهّز|جهز|حرّر|حرر|أنشئ|انشئ|اصغ)(?![؀-ۿ])/;
const DOC_TYPE = /لائحة|مذكرة|عقد|دعوى|طلب|اتفاقية|إنذار|انذار|وكالة|صحيفة/;

const REVIEW_VERB = /راجع|دقّق|دقق|قيّم|قيم|ما\s*رأيك\s*في|افحص|فحص|تحقّق\s*من|تدقيق|مراجعة/;
const CONTRACT_OBJ = /هذا\s*العقد|هذا\s*البند|هذه\s*الاتفاقية|المسودة|بنود\s*العقد|هذه\s*المذكرة/;

const DEFINITION_Q = /ما\s*(?:هو|هي)?\s*(?:معنى|تعريف|المقصود\s*ب)|(?:^|\s)عرّ?ف(?![؀-ۿ])|ماذا\s*يعني|ما\s*المقصود|ما\s*هو\s*تعريف/;

const DOCTRINAL_Q =
  /الفرق\s*بين|مقارن[ةه]\s*بين|هل\s*يجوز|هل\s*يعتبر|هل\s*يحق|هل\s*يمكن|ما\s*حكم|متى\s*(?:يجوز|يعتبر|يسقط|تسقط|ينعقد|يبدأ)|ما\s*(?:هي\s*)?شروط|ما\s*(?:هي\s*)?أركان|أيهما/;

// Fact-pattern signals: an actor, a narrated past action, and a claim/defence.
const ACTORS =
  /شخص|رجل|امرأ[ةه]|موكّ?ل[يه]|المدّ?عي|المدعى\s*عليه|صديق|شريك|زبون|عميل|صاحب\s*العمل|العامل|البائع|المشتري|المستأجر|المؤجّ?ر|فلان|زوج|زوج[ةه]|جار/;
const NARRATIVE =
  /أخذ|اخذ|قام\s*ب|اشترى|باع|وقّ?ع|حرّ?ر|ادّ?عى|زعم|رفض|اقترض|أقرض|سلّ?م|استلم|وعد|تعاقد|استأجر|أعطى|اعطى|طلب\s*منه|لم\s*يدفع|لم\s*يسدّ?د|امتنع|تسلّ?م|قبض|حصل\s*على/;
const CLAIM = /يدّ?عي|يزعم|بحج[ةه]|بذريع[ةه]|(?:ويقول|قال|يقول)\s*إن|قائلا|زاعما|على\s*أساس\s*أن|بدعوى\s*أن/;

// ------------------------------------------------------------------ ontology

// concept → the law that governs it and its legal area. Triggers are folded
// substrings, matched with the clitic-aware containsTerm so "بالشيك"/"الشيك"
// both hit "شيك" while a stem that merely contains it does not.
// Triggers are matched by containsTerm as folded SUBSTRINGS, not regex — write
// them as plain Arabic. foldForSearch unifies ة/ه, أ/إ/ا, ى/ي on both sides, so
// "إساءة الأمانة" here matches "اساءه الامانه" in a folded question.
type Concept = { label: string; law: string; area: string; triggers: string[] };
const CONCEPTS: Concept[] = [
  { label: "الشيك بدون رصيد", law: "قانون التجارة", area: "تجاري", triggers: ["شيك بدون رصيد", "شيك دون رصيد", "شيك بلا رصيد", "الشيك المرتجع", "شيك مرتجع"] },
  { label: "الأوراق التجارية", law: "قانون التجارة", area: "تجاري", triggers: ["شيك", "كمبيالة", "سند سحب", "سند لأمر", "سفتجة"] },
  { label: "الإفلاس", law: "قانون التجارة", area: "تجاري", triggers: ["إفلاس", "التفليسة", "الصلح الواقي"] },
  { label: "إساءة الائتمان", law: "قانون العقوبات", area: "جزائي", triggers: ["إساءة الأمانة", "إساءة الائتمان", "خيانة الأمانة", "اساءة ائتمان"] },
  { label: "الاحتيال", law: "قانون العقوبات", area: "جزائي", triggers: ["احتيال", "النصب"] },
  { label: "السرقة", law: "قانون العقوبات", area: "جزائي", triggers: ["سرقة", "السرقة"] },
  { label: "الجريمة والعقوبة", law: "قانون العقوبات", area: "جزائي", triggers: ["جريمة", "عقوبة", "جناية", "جنحة", "قصد جرمي"] },
  { label: "الأمانة والوديعة", law: "القانون المدني", area: "مدني", triggers: ["أمانة", "وديعة", "الإيداع"] },
  { label: "القرض", law: "القانون المدني", area: "مدني", triggers: ["قرض", "الاقتراض", "الدين"] },
  { label: "المسؤولية والتعويض", law: "القانون المدني", area: "مدني", triggers: ["تعويض", "المسؤولية", "الضرر", "الفعل الضار"] },
  { label: "العقد", law: "القانون المدني", area: "مدني", triggers: ["فسخ العقد", "بطلان العقد", "الالتزام التعاقدي", "إخلال بالعقد"] },
  { label: "الفصل التعسفي", law: "قانون العمل", area: "عمالي", triggers: ["فصل تعسفي", "الفصل التعسفي", "إنهاء عقد العمل", "الفصل من العمل"] },
  { label: "حقوق العامل", law: "قانون العمل", area: "عمالي", triggers: ["مكافأة نهاية الخدمة", "أجر العامل", "ساعات العمل الإضافية", "إصابة عمل"] },
  { label: "الشركات", law: "قانون الشركات", area: "شركات", triggers: ["شركة مساهمة", "مسؤولية محدودة", "ذ.م.م", "تصفية الشركة", "حصص الشركاء"] },
  { label: "الأحوال الشخصية", law: "قانون الأحوال الشخصية", area: "أحوال شخصية", triggers: ["طلاق", "نفقة", "حضانة", "الزواج", "المهر", "الميراث", "الوصية"] },
  { label: "الإثبات", law: "قانون البينات", area: "إجرائي", triggers: ["عبء الإثبات", "البينة", "الشهادة", "اليمين", "القرينة"] },
  { label: "الإجراءات والطعن", law: "قانون أصول المحاكمات", area: "إجرائي", triggers: ["الاختصاص", "الطعن", "الاستئناف", "التمييز", "الميعاد", "التبليغ"] },
  // Added alongside the 10 laws ingested 2026-07-19 — see legal-ontology.ts's
  // matching expansion entries and [[amendment-linking-infra]].
  // "المحكم" (the arbitrator) deliberately removed as a bare trigger, found
  // 2026-07-25 via the full benchmark regression run: containsTerm
  // (legal-topics.ts) only guards the boundary BEFORE a match, not after, so
  // "المحكم" matches as a literal prefix of "المحكمة" (the COURT — a
  // different word, not an inflection of "المحكم") wherever it appears.
  // That silently mis-tagged "ما هي المحكمة المختصة بنظر الدعوى الحقوقية؟"
  // (civ-06 in benchmark/legal-qa-100.json — a plain court-jurisdiction
  // question) as legalArea="تحكيم", which pulled in the arbitration
  // topic-boost and pushed the correct قانون اصول المحاكمات المدنية chunk out
  // of the top 8 (rank 6 → absent). "تحكيم" alone already covers this
  // concept's real signal; a fully general boundary-checking fix in
  // containsTerm would need to tell a genuine suffix (محكم+ة, if that were a
  // real inflection) apart from an unrelated word that happens to share a
  // prefix (محكم/محكمة are NOT the same word), which plain substring
  // matching cannot do reliably — narrower and safer to drop the one trigger
  // this collision depends on.
  { label: "التحكيم", law: "قانون التحكيم", area: "تحكيم", triggers: ["تحكيم", "هيئة التحكيم", "اتفاق التحكيم", "حكم التحكيم", "شرط تحكيم"] },
  { label: "تسجيل ونقل ملكية العقار", law: "قانون الملكية العقارية", area: "عقاري", triggers: ["تسجيل الأرض", "السجل العقاري", "سند التسجيل", "نقل ملكية العقار", "دائرة الأراضي والمساحة"] },
  { label: "الرهن العقاري وحق الشفعة", law: "قانون الملكية العقارية", area: "عقاري", triggers: ["رهن عقاري", "رهن تأميني", "حق الشفعة", "إزالة الشيوع"] },
  { label: "المالكين والمستأجرين", law: "قانون المالكين والمستأجرين", area: "عقاري", triggers: ["إخلاء المأجور", "بدل الإجارة", "المؤجر", "المستأجر"] },
  { label: "حماية المستهلك", law: "قانون حماية المستهلك", area: "استهلاكي", triggers: ["عيب السلعة", "المزود", "الإعلان المضلل", "حماية المستهلك", "استرجاع الثمن"] },
  { label: "ضريبة الدخل", law: "قانون ضريبة الدخل", area: "ضريبي", triggers: ["ضريبة الدخل", "الدخل الخاضع للضريبة", "الإقرار الضريبي", "الإعفاء الضريبي"] },
];

// Fallback area → law when a concept named an area but no single law.
const AREA_LAW: Record<string, string> = {
  تجاري: "قانون التجارة",
  جزائي: "قانون العقوبات",
  مدني: "القانون المدني",
  عمالي: "قانون العمل",
  شركات: "قانون الشركات",
  "أحوال شخصية": "قانون الأحوال الشخصية",
  إجرائي: "قانون أصول المحاكمات",
  تحكيم: "قانون التحكيم",
  عقاري: "قانون الملكية العقارية",
  استهلاكي: "قانون حماية المستهلك",
  ضريبي: "قانون ضريبة الدخل",
};

// intent.ts category vocabulary → this module's area labels.
const CATEGORY_AREA: Record<string, string> = {
  جزائية: "جزائي",
  مدنية: "مدني",
  حقوقية: "مدني",
  تجارية: "تجاري",
  عمالية: "عمالي",
  شركات: "شركات",
};

const QUERY_STOP = new Set([
  "ما","ماذا","هل","متى","اين","أين","كيف","لماذا","هو","هي","من","في","على","الى","إلى","عن","بين",
  "معنى","تعريف","الفرق","حكم","شروط","اركان","أركان","هذا","هذه","ذلك","التي","الذي","يجوز","يعتبر",
  "وما","وهل","او","أو","ثم","اذا","إذا","عند","بعد","قبل","كل","بعض","غير","نص","المقصود",
]);

function queryKeywords(question: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of question.replace(/[^؀-ۿ\w\s]/g, " ").split(/\s+/)) {
    const w = raw.trim();
    if (w.length < 3 || QUERY_STOP.has(w) || /^\d+$/.test(w)) continue;
    const key = foldForSearch(w);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

// ------------------------------------------------------------------ rules

const CONFIDENT = 0.7;
const EXPANDING_TYPES: QueryType[] = ["doctrinal_question", "fact_pattern"];

function detectConcepts(folded: string): Concept[] {
  return CONCEPTS.filter((c) => c.triggers.some((t) => containsTerm(folded, foldForSearch(t))));
}

function classifyType(question: string, folded: string, hasArticleNumber: boolean): { type: QueryType; confidence: number } {
  if (hasArticleNumber || ARTICLE_Q.test(question)) return { type: "article_lookup", confidence: 0.95 };
  if (DRAFT_VERB.test(question) && DOC_TYPE.test(question)) return { type: "drafting_request", confidence: 0.9 };
  if (REVIEW_VERB.test(question) && CONTRACT_OBJ.test(question)) return { type: "contract_review", confidence: 0.85 };

  const factSignals = [ACTORS, NARRATIVE, CLAIM].filter((re) => re.test(question)).length;
  const factPattern = factSignals >= 2 || (ACTORS.test(question) && NARRATIVE.test(question));
  if (factPattern) return { type: "fact_pattern", confidence: 0.78 };

  if (DOCTRINAL_Q.test(question)) return { type: "doctrinal_question", confidence: 0.8 };
  if (DEFINITION_Q.test(question)) return { type: "legal_definition", confidence: 0.85 };

  // Nothing matched cleanly. Make a weak guess by shape and flag it as
  // low-confidence so the LLM fallback (if enabled) refines it.
  const words = folded.split(/\s+/).filter(Boolean).length;
  const guess: QueryType = words <= 6 ? "legal_definition" : "doctrinal_question";
  return { type: guess, confidence: 0.4 };
}

/**
 * The synchronous, free tier. Resolves the clear cases with zero I/O.
 * `confidence < CONFIDENT` means "ask the LLM if it's available".
 */
export function analyzeQueryRules(question: string): QueryAnalysis {
  const folded = foldForSearch(question);
  const intent = parseIntent(question);

  const { type, confidence } = classifyType(question, folded, intent.articleNumbers.length > 0);
  const concepts = detectConcepts(folded);

  const area = concepts[0]?.area ?? (intent.category ? CATEGORY_AREA[intent.category] ?? null : null);
  const expectedLaw = concepts[0]?.law ?? (area ? AREA_LAW[area] ?? null : null);

  return {
    queryType: type,
    legalArea: area,
    expectedLaw,
    legalConcepts: concepts.map((c) => c.label),
    keywords: queryKeywords(question),
    needsExpansion: EXPANDING_TYPES.includes(type),
    method: "rules",
    confidence,
  };
}

// ------------------------------------------------------------------ LLM tier

const LLM_TIMEOUT_MS = 4000;

function buildClassifierPrompt(question: string) {
  return {
    system: `أنت مصنّف أسئلة قانونية أردنية. صنّف سؤال المحامي وأعد JSON فقط بلا أي نص آخر بهذا الشكل:
{"queryType": "...", "legalArea": "...", "expectedLaw": "...", "legalConcepts": ["..."]}

قيم queryType المسموحة حصراً:
- article_lookup: طلب نص مادة برقمها.
- legal_definition: طلب معنى/تعريف مصطلح.
- doctrinal_question: سؤال عن حكم أو فرق أو شروط دون وقائع.
- fact_pattern: وقائع قضية أو سيناريو أشخاص وأفعال.
- drafting_request: طلب صياغة وثيقة (لائحة/مذكرة/عقد).
- contract_review: طلب مراجعة عقد أو بند.

legalArea أحد: جزائي، مدني، تجاري، عمالي، شركات، أحوال شخصية، إجرائي، أو null.
expectedLaw اسم القانون الأردني الأرجح (مثل: قانون العقوبات) أو null.
legalConcepts مصطلحات قانونية وردت في السؤال (قائمة قد تكون فارغة).
لا تخترع أرقام مواد. أعد JSON صالحاً فقط.`,
    user: question,
  };
}

const VALID_TYPES = new Set<QueryType>([
  "article_lookup",
  "legal_definition",
  "doctrinal_question",
  "fact_pattern",
  "drafting_request",
  "contract_review",
]);

function parseClassifierJson(text: string): Partial<QueryAnalysis> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const queryType = VALID_TYPES.has(o.queryType) ? (o.queryType as QueryType) : undefined;
    return {
      queryType,
      legalArea: typeof o.legalArea === "string" && o.legalArea !== "null" ? o.legalArea : null,
      expectedLaw: typeof o.expectedLaw === "string" && o.expectedLaw !== "null" ? o.expectedLaw : null,
      legalConcepts: Array.isArray(o.legalConcepts) ? o.legalConcepts.filter((x: unknown) => typeof x === "string").slice(0, 8) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Full analysis: rules first, LLM fallback only when rules are unsure and the
 * fallback is enabled. Always returns — an LLM failure degrades to the rules
 * result, never throws into the request path.
 *
 * @param opts.allowLLM force the fallback off (e.g. drafting flow) regardless
 *        of confidence. Defaults to the env flag.
 */
export async function analyzeQuery(question: string, opts?: { allowLLM?: boolean }): Promise<QueryAnalysis> {
  const rules = analyzeQueryRules(question);

  const allowLLM = opts?.allowLLM ?? env.queryLlmFallback;
  if (rules.confidence >= CONFIDENT || !allowLLM) return rules;

  try {
    const { system, user } = buildClassifierPrompt(question);
    const provider = getChatProvider();
    const result = await Promise.race([
      provider.chat([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 200 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("classifier timeout")), LLM_TIMEOUT_MS)),
    ]);

    const parsed = parseClassifierJson(result.text);
    if (!parsed?.queryType) return rules;

    // LLM decides the type/area/law; keywords stay locally computed, and
    // needsExpansion is recomputed from the (possibly changed) type.
    const merged: QueryAnalysis = {
      ...rules,
      queryType: parsed.queryType,
      legalArea: parsed.legalArea ?? rules.legalArea,
      expectedLaw: parsed.expectedLaw ?? rules.expectedLaw,
      legalConcepts: parsed.legalConcepts?.length ? parsed.legalConcepts : rules.legalConcepts,
      needsExpansion: EXPANDING_TYPES.includes(parsed.queryType),
      method: "llm",
      confidence: rules.confidence,
    };
    return merged;
  } catch {
    // Timeout, bad JSON, provider error — the rules answer is still valid.
    return rules;
  }
}
