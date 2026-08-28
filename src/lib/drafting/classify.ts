import type { DraftKind } from "./forms";

/**
 * Routes a free-text message from the single chat input to either the
 * research pipeline (RAG chat) or the drafting assistant (dynamic form),
 * before it ever reaches the server.
 *
 * Deliberately NOT server-only, and deliberately not an LLM call: this runs
 * on every submit, so it has to be instant and free. The hard part isn't
 * detecting document names — it's that a lawyer asking "ما شروط فسخ عقد
 * المقاولة؟" and a lawyer asking "اكتب لي عقد مقاولة" share the same noun.
 * "عقد" alone is far too common in ordinary research questions about
 * contract law to trust as a trigger by itself — it needs a drafting verb
 * next to it. Multi-word document names ("لائحة جوابية", "مذكرة دفاع") are a
 * different story: nobody asks a research question using that exact phrase,
 * so those are trusted standalone.
 */

export type RouteClassification = { path: "research" } | { path: "drafting"; kind: DraftKind };

// Specific enough to be the filing action itself, not a topic — checked
// before the verb-gated fallback below, and fire with no verb required.
const STRONG_KIND_CUES: [RegExp, DraftKind][] = [
  [/لائحة\s*جوابي|(?:رد|جواب)(?:اً|ي|ية)?\s*(?:على|عن)\s*(?:لائحة|دعوى)/, "reply"],
  [/مذكرة\s*دفاع/, "defense_memo"],
  [/لائحة\s*دعوى/, "statement_of_claim"],
  [
    /(?:أريد|أرغب|بدي|بدى|محتاج)\s*(?:أن\s*)?(?:أرفع|أقيم)\s*دعوى|(?:رفع|إقامة)\s*دعوى\s*(?:ضد|على)/,
    "statement_of_claim",
  ],
  [/طلب\s*(?:حجز|تأجيل|إدخال)\s*(?:تحفظي|شخص)?|عريضة/, "petition"],
];

// "اكتب لي..." / "صغ لي..." / "حضّر لي..." — the imperative that turns a
// document-type noun into an actual request instead of a research topic.
const DRAFTING_VERB = /(?:اكتب|صِغ|صغ|حضّر|أعدّ|اعمل|جهّز|سوّد)\s*(?:لي\b)?/;

// Which kind a generic noun maps to, tried only once DRAFTING_VERB matched.
const NOUN_TO_KIND: [RegExp, DraftKind][] = [
  [/لائحة\s*جوابي/, "reply"],
  [/مذكرة\s*دفاع/, "defense_memo"],
  [/لائحة\s*دعوى/, "statement_of_claim"],
  [/عقد|اتفاقية/, "contract"],
  [/طلب|عريضة/, "petition"],
];

// Document nouns with no dedicated form yet (إنذار عدلي، وكالة، تعهد، إقرار).
// A drafting verb next to one of these still means "draft me a document", so
// it's still routed to drafting — "طلب قانوني" is the closest general shape
// among the supported kinds.
const OTHER_DOCUMENT_NOUN = /إنذار|وكالة|تعهد|إقرار/;

export function classifyRequest(text: string): RouteClassification {
  for (const [re, kind] of STRONG_KIND_CUES) {
    if (re.test(text)) return { path: "drafting", kind };
  }

  if (DRAFTING_VERB.test(text)) {
    for (const [re, kind] of NOUN_TO_KIND) {
      if (re.test(text)) return { path: "drafting", kind };
    }
    if (OTHER_DOCUMENT_NOUN.test(text)) return { path: "drafting", kind: "petition" };
  }

  return { path: "research" };
}
