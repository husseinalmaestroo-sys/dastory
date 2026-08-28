import "server-only";
import { foldForSearch } from "../ingest/clean";
import { containsTerm } from "../ingest/legal-topics";

/**
 * Arabic legal ontology: lay / descriptive wording → statutory terms.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A lawyer describes facts in everyday Arabic — "أخذ مبلغاً وقال إنه قرض" —
 * while the statute that governs it speaks of "مالٍ مسلَّم على وجه الأمانة". The
 * two share almost no surface words, so vector similarity is low and keyword
 * search finds nothing, even though the legal relationship is exact. This table
 * is the bridge: when a lay trigger appears in the question, its statutory
 * synonyms are merged into the search text BEFORE retrieval, so the query
 * vector shifts toward the language the corpus actually uses.
 *
 * HOW IT GROWS
 *
 * The seed below is hand-curated. The first source of new entries is real
 * failure: `scripts/mine-failed-queries.ts` mines `search_log` for the
 * questions that retrieved the fewest results, which are exactly the lay
 * phrasings the ontology is missing. Add them here as they surface.
 *
 * Matching is folded + clitic-aware (containsTerm), so "بالشيك"/"الشيك" both
 * hit "شيك" while a stem that merely contains it does not. Triggers and
 * expansions are plain Arabic — foldForSearch normalises ة/ه, أ/إ/ا, ى/ي.
 */

export type OntologyEntry = {
  /** Human label for the concept, for logging/debugging. */
  concept: string;
  /** Lay / descriptive phrasings a lawyer might type. */
  triggers: string[];
  /** Statutory terms to merge into the search text when a trigger matches. */
  statutory: string[];
};

export const LEGAL_ONTOLOGY: OntologyEntry[] = [
  {
    concept: "الشيك بدون رصيد",
    triggers: ["شيك بدون رصيد", "شيك بلا رصيد", "شيك مرتجع", "شيك راجع", "شيك بدون رصيد كافي", "رجع الشيك", "الشيك ما انصرف"],
    statutory: ["شيك بدون مقابل وفاء", "إصدار شيك دون رصيد", "جريمة الشيك", "المسؤولية الجزائية للشيك", "عدم كفاية الرصيد"],
  },
  {
    concept: "إساءة الائتمان / خيانة الأمانة",
    triggers: ["أخذ مال وقال قرض", "أخذ مبلغ وقال إنه قرض", "قرض وليس أمانة", "صرف المال المؤتمن", "تصرف بالمال المسلم له", "ما رجع الأمانة", "بدد المال"],
    statutory: ["مال مسلم على وجه الأمانة", "خيانة الأمانة", "إساءة الائتمان", "تبديد مال مؤتمن", "التصرف بمال الغير", "الاختلاس"],
  },
  {
    concept: "فصل الموظف / العامل",
    triggers: ["فصل موظف", "فصل عامل", "طرد من العمل", "إنهاء خدمات", "شالوه من الشغل", "فصلوه بدون سبب", "أنهى عقده"],
    statutory: ["فصل تعسفي", "إنهاء عقد العمل", "حقوق العامل", "التعويض عن الفصل", "إشعار الإنهاء", "مكافأة نهاية الخدمة"],
  },
  {
    concept: "الاحتيال / النصب",
    triggers: ["نصب عليه", "احتال عليه", "خدعه وأخذ ماله", "استولى على المال بالحيلة", "ضحك عليه وأخذ فلوسه"],
    statutory: ["الاحتيال", "الاستيلاء على مال الغير بطرق احتيالية", "استعمال طرق احتيالية", "الحمل على التسليم"],
  },
  {
    concept: "السرقة",
    triggers: ["سرق", "سرقة", "أخذ الشيء خفية", "استولى على مال بدون إذن"],
    statutory: ["السرقة", "أخذ مال منقول مملوك للغير دون رضاه", "اختلاس المال المنقول"],
  },
  {
    concept: "حادث سير / ضرر",
    triggers: ["حادث سير", "صدمه بالسيارة", "سبب له ضرر", "أتلف ماله", "أضر به"],
    statutory: ["الفعل الضار", "المسؤولية التقصيرية", "التعويض عن الضرر", "الضرر والتعويض", "علاقة السببية"],
  },
  {
    concept: "الطلاق والفراق",
    triggers: ["طلقها", "بدها تطلق", "يبي يطلق", "خلافات زوجية", "فرقة الزوجين", "بدي أفارق زوجتي"],
    statutory: ["الطلاق", "التطليق", "الفرقة بين الزوجين", "فسخ عقد الزواج", "التفريق"],
  },
  {
    concept: "الإيجار والإخلاء",
    triggers: ["مستأجر ما يدفع", "بدي أطلع المستأجر", "إخلاء المأجور", "صاحب الملك بده يطلعني", "ما دفع الأجرة"],
    statutory: ["إخلاء المأجور", "بدل الإيجار", "عقد الإيجار", "المأجور", "التخلف عن دفع الأجرة"],
  },
  {
    concept: "عدم سداد الدين",
    triggers: ["ما رجع الدين", "ماطل بالدفع", "مدين ما بيدفع", "استدان وما سدد"],
    statutory: ["المطالبة بالدين", "الوفاء بالالتزام", "التخلف عن السداد", "المدين والدائن", "حلول الأجل"],
  },
  {
    concept: "شركة مساهمة خاصة",
    triggers: ["شركة مساهمة خاصة", "تأسيس شركة", "بدي أسجل شركة", "فتح شركة", "شركاء بشركة"],
    statutory: ["الشركات المساهمة الخاصة", "قانون الشركات", "عقد التأسيس", "النظام الأساسي للشركة", "رأس المال المصرح به"],
  },
  // The 10 laws added 2026-07-19 (see [[jordanian-legal-pdf-sources]] /
  // amendment-linking-infra): commercial/company/property/tax/consumer/
  // arbitration statutes a lawyer describes in lay terms just as often as the
  // original جزائي/مدني/عمالي seed above did.
  {
    concept: "التحكيم",
    triggers: ["شرط التحكيم في العقد", "اتفقنا نحل الخلاف عند محكم", "بند تحكيم بالعقد", "لجأنا لمحكم", "حكم التحكيم", "هيئة تحكيم"],
    statutory: ["اتفاق التحكيم", "هيئة التحكيم", "حكم التحكيم", "بطلان حكم التحكيم", "المحكم"],
  },
  {
    concept: "تسجيل ونقل ملكية العقار",
    triggers: ["تسجيل الأرض باسمه", "نقل ملكية البيت", "تسجيل العقار", "الأرض مسجلة باسم", "بدي أسجل الشقة", "وكالة بيع عقار", "تسجيل عقار", "بيع عقار", "شراء عقار", "أسجل الأرض"],
    statutory: ["السجل العقاري", "سند التسجيل", "دائرة الأراضي والمساحة", "معاملة التسجيل", "مديرية التسجيل"],
  },
  {
    concept: "الرهن العقاري وحق الشفعة",
    triggers: ["رهن البيت", "رهن العقار على القرض", "بدي أشتري حصة شريكي", "حق الشفعة بالعقار", "شريك بالعقار باع حصته"],
    statutory: ["الرهن التأميني", "حق الشفعة", "إزالة الشيوع في العقار", "الدائن المرتهن"],
  },
  {
    concept: "إخلاء المستأجر وبدل الإيجار",
    triggers: ["المستأجر ما يدفع الأجرة", "بدي أخلي المستأجر", "زيادة بدل الإيجار", "المؤجر رفض يرجع التأمين", "طلع من البيت المستأجر"],
    statutory: ["إخلاء المأجور", "بدل الإجارة", "المؤجر والمستأجر", "الإنذار العدلي"],
  },
  {
    concept: "عيب السلعة وحقوق المستهلك",
    triggers: ["المنتج طلع معيوب", "الجهاز ما اشتغل من أول يوم", "رفض يرجعلي فلوسي", "غشوني بالبضاعة", "إعلان كاذب عن منتج", "خدمة ما بعد البيع ما وفروها", "منتج معيوب", "بضاعة معيبة", "سلعة معيبة", "معيوب"],
    statutory: ["عيب السلعة", "المزود", "الإعلان المضلل", "استرجاع الثمن", "الضمان وخدمات ما بعد البيع"],
  },
  {
    concept: "ضريبة الدخل",
    triggers: ["ضريبة على راتبي", "ما قدم إقرار ضريبي", "معفى من الضريبة", "الدائرة طالبته بضريبة", "ضريبة على أرباح الشركة", "ضريبة الدخل", "ضريبة دخل"],
    statutory: ["الدخل الخاضع للضريبة", "الإقرار الضريبي", "الإعفاءات الضريبية", "التقدير الإداري", "دائرة ضريبة الدخل والمبيعات"],
  },
  {
    concept: "إثبات الحق وعبء البينة",
    triggers: ["كيف يثبت حقه", "ما عنده ورقة تثبت", "شهود على الواقعة", "أنكر التوقيع على السند", "وين البينة عليه"],
    statutory: ["عبء الإثبات", "البينة الخطية", "الإقرار", "اليمين الحاسمة", "القرينة القانونية"],
  },
  // NOT a lay-phrasing bridge like the entries above — a morphological one.
  // "ما عقوبة السرقة؟" and "المادة 401: يعاقب... من ارتكب السرقة..." share the
  // root ع-ق-ب but not a token: "عقوبة" (the penalty, a noun) and "يعاقب"
  // (shall be punished, a verb) are genuinely different derivations of it, and
  // arabic-stem.ts is deliberately a LIGHT stemmer (strips prefixes/suffixes,
  // folds letter variants) — it does not do full root extraction, so it does
  // not unify a noun with a verb built on the same root. Confirmed live and
  // directly against the DB (2026-07-24): "ما هي عقوبة السرقة؟" scored ZERO
  // keyword/stem hits (every penalty article phrases it as "يعاقب", not
  // "عقوبة") and fell back entirely to vector similarity, which was not
  // discriminating enough — the top 8 mixed real theft-penalty articles with
  // unrelated ones (counterfeiting, currency law) that merely happen to also
  // contain "يعاقب" somewhere. This one trigger fixes it for every crime's
  // penalty question, not just theft, since virtually the entire penal code
  // phrases its penalties this same way.
  {
    concept: "عقوبة (اسم) ↔ يعاقب (فعل) — نفس الجذر، صيغة مختلفة",
    triggers: ["عقوبة", "عقوبات", "عقاب", "معاقبة", "جزاء"],
    statutory: ["يعاقب", "معاقبة"],
  },

  // ---------------------------------------------------------------------
  // DOCTRINAL/COMPARISON cluster, added 2026-07-25 after a live false-refusal
  // report on "ما الفرق بين البطلان المطلق والبطلان النسبي؟".
  //
  // A THIRD register, distinct from both entries above: the seed entries
  // bridge LAY narrative ("فصلوه من شغله") to statute, and the عقوبة/يعاقب
  // entry bridges a noun to a verb of the SAME root. Doctrinal/comparison
  // questions ("ما الفرق بين X و Y؟") use neither — they use legal-academic
  // terminology that is often not the statute's own wording AND not
  // something a layperson would say either. "البطلان النسبي" is a real,
  // widely-taught legal category, but the Jordanian Civil Code itself never
  // uses that phrase — it regulates the same substance under "العقد الموقوف"
  // (the suspended contract) and the vitiating-consent articles (الغلط،
  // التغرير، الإكراه، الاستغلال — عيوب الرضا). Confirmed directly against the
  // DB (2026-07-25, scripts/tmp-diagnose-nullity*.ts): querying the exact
  // question's own embedding, article 176 (العقد الموقوف) scored 0.354 —
  // below the doctrinal_question gate (0.36) and outside the raw top-40
  // vector matches entirely — while the pool that DID clear the gate was
  // half irrelevant noise sharing only the bare word "بطلان" (an arbitration
  // award's nullity, a judge's procedural act's nullity, an unrelated
  // property-law article). Retrieval silently returned only HALF of a
  // comparison question with no signal that anything was missing, and GPT's
  // generation-side "never invent" instruction — correctly applied to a
  // half-covered comparison — then read as "the sources don't really answer
  // this" and refused entirely.
  //
  // Same pattern confirmed on a second, unrelated domain
  // (scripts/tmp-before-after-comparisons.ts): "ما الفرق بين الفصل التعسفي
  // والفصل المشروع؟" — a common labor-law comparison — collapsed to a single
  // retrieved chunk from the WRONG law entirely (أحوال شخصية, not عمل),
  // because the existing "فصل الموظف / العامل" entry above only triggers on
  // narrative lay phrasing ("فصل موظف", "طرد من العمل") and neither that nor
  // any other entry recognised "الفصل المشروع" — the doctrinal name for the
  // employer's lawful grounds — as a trigger at all. So: the fix is not
  // "add one nullity entry", it is "give every entry with a doctrinal
  // opposite pair its OWN doctrinal-phrasing triggers", which is what this
  // whole block does, one legal institution at a time, not just for the
  // question that happened to be reported.
  {
    concept: "البطلان النسبي / قابلية الإبطال (عيوب الرضا ونقص الأهلية)",
    triggers: [
      "البطلان النسبي", "بطلان نسبي", "قابلية الإبطال", "قابل للإبطال", "العقد القابل للإبطال",
      "قابلية العقد للإبطال", "حق طلب الإبطال", "طلب إبطال العقد",
    ],
    statutory: [
      "العقد الموقوف", "عيوب الرضا", "الغلط", "التغرير والغبن", "الإكراه", "الاستغلال",
      "نقص الأهلية", "إجازة العقد", "ولي أو وصي",
    ],
  },
  {
    concept: "البطلان المطلق / العقد الباطل (انعدام الأثر)",
    // The absolute-nullity side already retrieves reasonably well on its own
    // (المادة 168/169 use "الباطل"/"البطلان" directly), but a comparison question
    // asks for BOTH sides in one query and this reinforces the side that is
    // NOT the newly-added entry above, so neither side of "الفرق بين... و..."
    // starves the other for search-text budget once both entries' terms are
    // merged (query-expansion.ts caps merged terms at MAX_TERMS=8 total).
    triggers: ["البطلان المطلق", "بطلان مطلق"],
    statutory: ["العقد الباطل", "اختلال الركن أو المحل أو السبب", "انعدام الأثر", "بطلان لا يلحقه إجازة"],
  },
  {
    concept: "الفصل التعسفي / الفصل المشروع (مقارنة)",
    // Deliberately separate from "فصل الموظف / العامل" above rather than
    // merged into it: that entry's triggers are lay/narrative ("طرد من
    // العمل") and its statutory list is the wrongful-dismissal side only.
    // "الفصل المشروع" needs the OPPOSITE statutory vocabulary — the
    // employer's lawful grounds — so folding it into the same entry would
    // mean a narrative "فصلوه بدون سبب" question (which is never about lawful
    // grounds) pulls in lawful-dismissal vocabulary it has no use for.
    triggers: ["الفصل المشروع", "فصل مشروع", "فصل غير تعسفي", "إنهاء مشروع لعقد العمل"],
    statutory: ["فصل العامل دون إشعار", "مخالفة العامل لتعليمات العمل", "أسباب فصل العامل بدون مكافأة", "الفصل لسبب مشروع"],
  },
  {
    concept: "المسؤولية العقدية / المسؤولية التقصيرية (مقارنة)",
    triggers: ["المسؤولية العقدية", "مسؤولية عقدية", "المسؤولية التقصيرية", "مسؤولية تقصيرية", "المسؤولية التعاقدية"],
    statutory: ["الإخلال بالالتزام التعاقدي", "الفعل الضار", "الضرر والتعويض", "علاقة السببية", "التعويض عن عدم التنفيذ"],
  },
  {
    concept: "الجريمة المدنية (مصطلح غير تشريعي) → الفعل الضار",
    // Jordanian law has no formal "جريمة مدنية" category — "جريمة" is a penal
    // concept by definition. A lawyer asking to compare it against "الجريمة
    // الجزائية" almost always means the civil-wrong/tort side of that
    // distinction, so this bridges to the real statutory institution instead
    // of returning nothing (or, worse, tempting GPT to invent a "civil crime"
    // category the sources don't support — see CLOSED_DOMAIN_RULES).
    triggers: ["الجريمة المدنية", "جريمة مدنية"],
    statutory: ["الفعل الضار", "المسؤولية التقصيرية", "التعويض عن الضرر"],
  },
  {
    concept: "الشرط الفاسخ / الشرط الواقف (مقارنة)",
    triggers: ["الشرط الفاسخ", "شرط فاسخ", "الشرط الواقف", "شرط واقف", "الأجل الواقف"],
    statutory: ["الالتزام المعلق على شرط", "الشرط المعلق عليه العقد", "زوال الالتزام بتحقق الشرط"],
  },
  {
    concept: "الفسخ مقابل البطلان (عقود)",
    // "ما الفرق بين البطلان والفسخ؟" (con-18 in benchmark/legal-qa-100.json)
    // needs the فسخ vocabulary reinforced for the same reason as "البطلان
    // المطلق" above: without it, a query already rich in "بطلان" wording pulls
    // toward nullity chunks and away from the rescission/termination side,
    // even though both are explicitly asked about.
    triggers: ["الفرق بين البطلان والفسخ", "البطلان والفسخ"],
    statutory: ["فسخ العقد للإخلال بالالتزام", "انحلال العقد", "آثار انحلال العقد", "الفسخ بحكم القضاء"],
  },
  {
    concept: "أسباب الإباحة وموانع المسؤولية (جزائي)",
    // Shares no root with the existing "الجريمة والعقوبة" concept's triggers
    // (جريمة/عقوبة/جناية/جنحة/قصد جرمي) — "إباحة" and "موانع" are a distinct
    // penal-law vocabulary for justification/excuse defences, so that concept
    // entry's legalArea resolution never fires for this question either.
    triggers: ["أسباب الإباحة", "موانع المسؤولية", "موانع العقاب", "أسباب التبرير", "موانع العقوبة"],
    statutory: ["الدفاع الشرعي", "حالة الضرورة", "تنفيذاً لأمر القانون", "استعمال الحق", "انتفاء القصد الجرمي", "الإكراه المعنوي"],
  },
  {
    concept: "القرض مقابل الوديعة (تمييز الأمانة)",
    triggers: ["الفرق بين القرض والوديعة", "القرض والوديعة"],
    statutory: ["ضمان هلاك المقترض", "رد المثل", "أمانة في يد المودع لديه", "رد عين الوديعة"],
  },
];

export type OntologyMatch = { concept: string; terms: string[] };

/**
 * Finds the statutory terms to add for a question, and which concepts matched.
 * Pure and synchronous — no I/O — so it costs nothing to run on every query.
 * A statutory term already present (folded) in the question is skipped, so the
 * expansion only ever ADDS the missing legal vocabulary.
 */
// containsTerm's phrase branch (legal-topics.ts) requires the folded trigger to
// appear as an exact contiguous substring, which is right for single words but
// too rigid for a multi-word narrative trigger: a lawyer's sentence inflects
// words the seed phrase wrote in their bare form. The case caught live
// (2026-07-25, mine-failed-queries.ts): trigger "قرض وليس أمانة" missed
// "المال كان قرضاً وليس أمانة" outright — "قرضاً" carries تنوين النصب (the
// indefinite accusative), which is a real letter (ألف), not a diacritic, so
// foldForSearch's diacritic stripping does not remove it. Rather than touch
// foldForSearch (it also builds the corpus's stored folded_text/content_tsv,
// so changing it would need a full reindex), each trigger word is matched with
// an optional trailing alef, scoped to ontology matching only.
function phraseMatches(folded: string, phrase: string): boolean {
  if (!phrase.includes(" ")) return containsTerm(folded, phrase);
  const pattern = phrase
    .split(" ")
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "ا?")
    .join("\\s+");
  return new RegExp(pattern).test(folded);
}

export function expandWithOntology(question: string): { terms: string[]; matches: OntologyMatch[] } {
  const folded = foldForSearch(question);
  const seen = new Set<string>();
  const terms: string[] = [];
  const matches: OntologyMatch[] = [];

  for (const entry of LEGAL_ONTOLOGY) {
    const hit = entry.triggers.some((t) => phraseMatches(folded, foldForSearch(t)));
    if (!hit) continue;

    const added: string[] = [];
    for (const term of entry.statutory) {
      const key = foldForSearch(term);
      if (seen.has(key) || containsTerm(folded, key)) continue; // dedupe + skip already-present
      seen.add(key);
      terms.push(term);
      added.push(term);
    }
    if (added.length) matches.push({ concept: entry.concept, terms: added });
  }

  return { terms, matches };
}
