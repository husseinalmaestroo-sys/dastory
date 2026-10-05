import "server-only";
import { foldForSearch } from "../ingest/clean";

/**
 * Source classes (corpus repair, 2026-10). What KIND of text a source is
 * decides how much it can say: a law states the rule, a regulation or an
 * instruction implements it, an interpretation decision of the Special Bureau
 * binds its reading, a court decision applies it, a memorandum of
 * understanding binds only the bodies that signed it, and secondary material
 * (commentary, templates) states nobody's rule.
 *
 *   legislation      the Constitution, laws and amending laws
 *   regulation       أنظمة
 *   instruction      تعليمات
 *   interpretation   decisions of the Special Bureau for the Interpretation of Laws
 *   court_decision   court decisions and judicial principles
 *   mou              memoranda of understanding between public bodies
 *   secondary        commentary, templates and other secondary material
 *
 * The class comes from the stored source_type; for rows filed before the
 * 'interpretation' and 'mou' types existed it also reads an unambiguous title
 * prefix ("مذكرة تفاهم", "قرار الديوان الخاص بتفسير"), so the safety rules
 * below hold before the repair manifest has reclassified them.
 */
export type SourceClass = "legislation" | "regulation" | "instruction" | "interpretation" | "court_decision" | "mou" | "secondary";

const MOU_TITLE = /^(?:ال)?مذكر[هة]\s+(?:ال)?تفاهم/;
const DIWAN_TITLE = /^قرار\s+(?:ال)?ديوان\s+(?:ال)?خاص\s+بتفسير/;

export function sourceClassOf(sourceType: string | null | undefined, title?: string | null): SourceClass {
  const t = title ? foldForSearch(title).trim() : "";
  if (sourceType === "mou" || MOU_TITLE.test(t)) return "mou";
  if (sourceType === "interpretation" || (sourceType === "principle" && DIWAN_TITLE.test(t))) return "interpretation";
  switch (sourceType) {
    case "law":
      return "legislation";
    case "regulation":
      return "regulation";
    case "instruction":
      return "instruction";
    case "court_decision":
    case "principle":
      return "court_decision";
    default:
      // template, secondary, or anything unknown: never a rule of law.
      return "secondary";
  }
}

/** Legislation in the broad sense — the texts that state or implement the rule. */
export function isLegislative(c: SourceClass): boolean {
  return c === "legislation" || c === "regulation" || c === "instruction";
}

/**
 * Presentation order of classes when more than one answers a question:
 * applicable legislation first, then binding interpretations, then court
 * decisions, then memoranda and secondary material. Within a tier the
 * retrieval score decides. Higher lexical similarity never lifts a lower tier
 * over an applicable (admitted) legislative text.
 */
export function classTier(c: SourceClass): number {
  if (isLegislative(c)) return 0;
  if (c === "interpretation") return 1;
  if (c === "court_decision") return 2;
  return 3;
}

/** The Arabic label shown on a source card. */
export const SOURCE_CLASS_LABEL_AR: Record<SourceClass, string> = {
  legislation: "تشريع",
  regulation: "نظام",
  instruction: "تعليمات",
  interpretation: "قرار تفسيري (الديوان الخاص بتفسير القوانين)",
  court_decision: "قرار قضائي",
  mou: "مذكرة تفاهم",
  secondary: "مادة ثانوية",
};

/** The source_type a title prefix says a row should carry, when it carries another (for the inventory and the repair manifest). */
export function expectedSourceType(sourceType: string, title: string): string | null {
  const t = foldForSearch(title).trim();
  if (MOU_TITLE.test(t) && sourceType !== "mou") return "mou";
  if (DIWAN_TITLE.test(t) && sourceType === "principle") return "interpretation";
  return null;
}

/**
 * Questions that ask for court decisions or binding interpretations: a
 * decision number, or an explicit "اجتهاد / قرار محكمة … / أحكام التمييز /
 * الديوان الخاص بتفسير". Deliberately not a bare "حكم" — "ما حكم القانون في …"
 * asks for the rule of law, not for a judgment — and not a bare "قرار", which
 * is as often an administrative decision under a law.
 */
// Written in the FOLDED form (foldForSearch: ة→ه, ئ→ي, أ/إ/آ→ا), which is what they are matched against.
const DECISION_WORDS =
  /اجتهاد|سوابق\s*قضايي|سابقه\s*قضايي|مبدا\s*قضايي|(?:ال)?مبادي\s*(?:ال)?قضايي|محكمه\s*(?:ال)?تمييز|(?:قرار|قرارات|حكم|احكام)\s+(?:ال)?محكم|(?:قرار|قرارات|حكم|احكام)\s+(?:ال)?(?:تمييز|استيناف|بدايه|صلح|عدل\s*(?:ال)?عليا|قضايي|قضاء)|(?:ال)?ديوان\s+(?:ال)?خاص\s+بتفسير|قرار(?:ات)?\s+(?:ال)?تفسير/;
const MOU_WORDS = /مذكره\s*(?:ال)?تفاهم|مذكرات\s*(?:ال)?تفاهم/;

export function seeksDecisions(question: string, hasDecisionNumber = false): boolean {
  return hasDecisionNumber || DECISION_WORDS.test(foldForSearch(question));
}

export function seeksMou(question: string): boolean {
  return MOU_WORDS.test(foldForSearch(question));
}

/**
 * Orders admitted retrieval results by source class (classTier), keeping the
 * incoming (score) order within each tier, and applies `cutoff` (the score-gap
 * trim) within each tier — so a cliff in one class never trims another.
 *
 * Runs AFTER the relevance gate: only legislation admitted on its own evidence
 * is lifted, and a memorandum or a secondary text never outranks it on higher
 * lexical similarity. Exceptions, both explicit in the question:
 *   • it asks for decisions (seeksDecisions) — court decisions and
 *     interpretations then rank with legislation, by score;
 *   • it asks about a memorandum of understanding — memoranda rank with it too.
 * The exact citation the lawyer named (exact_hit) always ranks in the first tier.
 */
export function orderBySourceClass<T extends { source_type: string; source_title: string; exact_hit?: boolean }>(
  list: T[],
  question: string,
  opts: { hasDecisionNumber?: boolean; cutoff?: (tier: T[]) => T[] } = {}
): T[] {
  const decisions = seeksDecisions(question, opts.hasDecisionNumber ?? false);
  const mou = seeksMou(question);
  const tiers = new Map<number, T[]>();
  for (const c of list) {
    const cls = sourceClassOf(c.source_type, c.source_title);
    let tier = classTier(cls);
    if (c.exact_hit) tier = 0;
    else if (decisions && (cls === "court_decision" || cls === "interpretation")) tier = 0;
    else if (mou && cls === "mou") tier = 0;
    tiers.set(tier, [...(tiers.get(tier) ?? []), c]);
  }
  const cutoff = opts.cutoff ?? ((t: T[]) => t);
  return [...tiers.keys()].sort((a, b) => a - b).flatMap((t) => cutoff(tiers.get(t) as T[]));
}
