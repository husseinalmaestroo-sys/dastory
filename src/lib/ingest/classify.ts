import "server-only";
import { basename, extname } from "node:path";
import { normalizeTitle } from "./title";

/**
 * Corpus repair (2026-10): 'interpretation' (decisions of the Special Bureau
 * for the Interpretation of Laws), 'mou' (memoranda of understanding) and
 * 'secondary' (commentary and other secondary material) are their own types —
 * before, a memorandum was filed as an 'instruction' and a binding
 * interpretation as a 'principle' for want of one (corpus/source-class.ts).
 */
export type SourceType = "law" | "regulation" | "instruction" | "court_decision" | "principle" | "template" | "interpretation" | "mou" | "secondary";

export const SOURCE_TYPES: SourceType[] = [
  "law",
  "regulation",
  "instruction",
  "court_decision",
  "principle",
  "template",
  "interpretation",
  "mou",
  "secondary",
];

export type Classification = {
  type: SourceType | null;
  /** How the verdict was reached. `null` type means: ask a human. */
  basis: "explicit" | "filename-leading" | "filename" | "folder" | "unknown";
};

/**
 * Jordanian legal documents are named by their kind, first word first:
 * "نظام رسوم الكاتب العدل 2026", "تعليمات المراقبة الالكترونية 2025",
 * "قانون العقوبات وتعديلاته رقم 16 لسنة 1960". The leading token is therefore
 * the strongest signal available, and it is checked before anything else.
 *
 * NOTE the end-of-token guard is `(?![؀-ۿ])`, not `\b`.
 *
 * JavaScript's `\b` is defined against `\w`, i.e. [A-Za-z0-9_] — Arabic letters
 * are not word characters to it, so there is never a boundary between "م" and
 * the following space and `/^نظام\b/` never matches anything. Written with
 * `\b`, every pattern in this table was dead: classification silently fell
 * through to CONTAINS, which filed "نظام المكتب الفني لمحكمة التمييز" as a
 * court decision because the title mentions التمييز. The tests passed anyway,
 * because CONTAINS ordering happened to give the right answer for the cases
 * they covered — which is exactly how a dead code path survives a test suite.
 */
const LEADING: [RegExp, SourceType][] = [
  // Corpus repair: the two-word kinds first — "مذكرة تفاهم" is neither an
  // instruction nor a decision, and "قرار الديوان الخاص بتفسير …" is a binding
  // interpretation, not a court decision.
  [/^(?:ال)?مذكر[ةه]\s+(?:ال)?تفاهم(?![؀-ۿ])/, "mou"],
  [/^(?:ال)?قرار\s+(?:ال)?ديوان\s+(?:ال)?خاص\s+بتفسير/, "interpretation"],
  [/^(?:ال)?تعليمات(?![؀-ۿ])/, "instruction"],
  // A pleading ("لائحة دعوى", "لائحة جوابية" …) is a drafting template; any
  // other "لائحة" is a regulatory schedule ("لائحة أجور أتعاب الكاتب العدل
  // المرخص"), which used to be filed as a template and ranked as one.
  [/^(?:ال)?لائحة\s+(?:دعوى|الدعوى|جوابية|استئناف|الاستئناف|اعتراض|طعن|تمييز)(?![؀-ۿ])/, "template"],
  [/^(?:ال)?لائحة(?![؀-ۿ])/, "regulation"],
  [/^(?:ال)?نظام(?![؀-ۿ])/, "regulation"],
  [/^(?:ال)?قانون(?![؀-ۿ])/, "law"],
  [/^(?:ال)?دستور(?![؀-ۿ])/, "law"],
  // An executive decision issued under a law ("قرار بتحديد الصحف الأوسع
  // انتشاراً", listed by moj.gov.jo with its regulations) is secondary
  // legislation, not a court decision — the nearest type is 'instruction'.
  [/^(?:ال)?قرار\s+ب(?:تحديد|تعيين|تنظيم|اصدار|إصدار|شأن)/, "instruction"],
  [/^(?:ال)?قرار(?![؀-ۿ])/, "court_decision"],
  [/^(?:ال)?حكم(?![؀-ۿ])/, "court_decision"],
  [/^(?:ال)?مبدأ(?![؀-ۿ])/, "principle"],
  [/^(?:ال)?نموذج(?![؀-ۿ])/, "template"],
];

/**
 * Unanchored fallbacks, ordered most-specific-first — and the order is the
 * whole point.
 *
 * "نظام معدل لنظام المساعدة القانونية" contains "القانونية", which contains
 * "قانون". Checking law before regulation files that regulation as a law. The
 * fix is not a cleverer regex but an honest precedence: the rarer word wins,
 * because a regulation may mention laws while a law rarely calls itself a
 * regulation.
 */
const CONTAINS: [RegExp, SourceType][] = [
  [/تعليمات|taleemat|instruction/i, "instruction"],
  [/مبادئ|مبدأ|اجتهاد|ijtihad|mabda/i, "principle"],
  [/نماذج|نموذج|لائحة\s+(?:دعوى|الدعوى|جوابية|استئناف)|namouzaj|template/i, "template"],
  // Transliterations included because people name folders "tamyeez"/"bidaya"
  // far more often than they type Arabic into a path.
  [
    /تمييز|استئناف|بداية|قرار|حكم|أحكام|tamyeez|isti'?naf|bidaya|cassation|appeal|qarar|hukm|ahkam|decision/i,
    "court_decision",
  ],
  [/أنظمة|انظمة|نظام|لوائح|لائحة|nizam|regulation/i, "regulation"],
  [/دستور|dustour|constitution/i, "law"],
  // Last: "قانون" appears inside "قانونية"/"القانوني", which show up in the
  // titles of regulations and instructions constantly.
  [/قوانين|قانون|qanun|\blaws?\b/i, "law"],
];

/**
 * Decides a source's type from its path.
 *
 * Returns `type: null` rather than guessing when nothing matches. The previous
 * version defaulted to "court_decision", which silently filed the Jordanian
 * Constitution — whose files are named "الفصل01".."الفصل10" — as court
 * rulings. A wrong type is not cosmetic: it drives the `sourceType` search
 * filter and the chunking strategy, so a misfiled source is invisible to the
 * queries that should find it.
 */
export function classifySource(filePath: string, explicit?: string | null): Classification {
  if (explicit) {
    if (!SOURCE_TYPES.includes(explicit as SourceType)) {
      throw new Error(`Invalid source type "${explicit}". One of: ${SOURCE_TYPES.join(", ")}`);
    }
    return { type: explicit as SourceType, basis: "explicit" };
  }

  // Normalised first: "قانــــون"/"نظـام" (justification tatweel) missed every
  // leading-word rule and fell through to weaker guesses (corpus repair).
  const file = normalizeTitle(basename(filePath, extname(filePath)).replace(/[_-]+/g, " "));

  for (const [re, t] of LEADING) if (re.test(file)) return { type: t, basis: "filename-leading" };
  for (const [re, t] of CONTAINS) if (re.test(file)) return { type: t, basis: "filename" };

  // Only now consider the folder. It is the weakest signal by far: a download
  // directory called "moj-laws" would otherwise stamp "law" onto every file
  // inside it, including the regulations and instructions the ministry files
  // under the same section.
  const folder = filePath.slice(0, filePath.length - basename(filePath).length);
  for (const [re, t] of CONTAINS) if (re.test(folder)) return { type: t, basis: "folder" };

  return { type: null, basis: "unknown" };
}
