import "server-only";
import { foldForSearch } from "../ingest/clean";
import { expandWithOntology, type OntologyMatch } from "./legal-ontology";
import type { QueryAnalysis } from "./query-understanding";
import { getChatProvider } from "../ai";
import { env } from "../env";

/**
 * Legal query expansion — merged into the search text BEFORE retrieval.
 *
 * TWO SOURCES, in cost order:
 *   1. `legal-ontology.ts` — a curated lay→statutory table. Synchronous, free,
 *      runs on every query. Grown from real failures mined out of `search_log`
 *      (see scripts/mine-failed-queries.ts).
 *   2. An LLM call — ONLY for `fact_pattern` questions, which is where a lawyer
 *      narrates facts in everyday words and the ontology is most likely to be
 *      missing the bridge. Every other query type is served by the table alone.
 *
 * ONE EMBEDDING, NOT ONE PER TERM. The expansions are merged into a single
 * search string that is embedded once — expanding into N separate vectors would
 * multiply both latency and embedding spend for a gain that fusion already
 * provides. The keyword arm gets the same terms as an OR-group tsquery, so a
 * statutory synonym can match lexically without narrowing the original query
 * (appending them to the websearch string would AND them and match strictly
 * fewer documents — the opposite of expansion).
 */

export type Expansion = {
  /** What to embed: the original question plus the merged statutory terms. */
  searchText: string;
  /** The terms that were added (never terms already in the question). */
  addedTerms: string[];
  /** tsquery OR-group for the keyword arm, or "" when nothing was added. */
  orGroup: string;
  matches: OntologyMatch[];
  source: "none" | "ontology" | "llm" | "both";
};

// Bounded so the merged text stays close to the lawyer's actual question — an
// over-expanded query embeds to the centroid of a topic instead of the point.
const MAX_TERMS = 8;
const LLM_TIMEOUT_MS = 4000;

/**
 * Function words, in folded form. Dropped from each phrase before it becomes an
 * AND-group: a statutory phrase ANDed word-for-word is far too strict —
 * "شيك & بدون & مقابل & وفاء" demands all four tokens in one chunk and matched
 * nothing against the real corpus, while "شيك & مقابل & وفاء" finds the article.
 * Only the content words carry the legal meaning.
 */
const TSQ_STOP = new Set([
  "بدون","دون","علي","عن","في","من","الي","او","و","ثم","مع","عند","بين","هذا","هذه",
  "التي","الذي","وجه","سبيل","غير","كل","اي","ما","لا","ان","به","له","عليه","نحو","بما",
]);

/**
 * Builds a tsquery OR-group: each phrase becomes an AND of its CONTENT words,
 * and the phrases are OR'd together — "مقابل & وفاء | شيك & مرتجع".
 *
 * Sanitised down to Arabic/word characters before assembly, because the string
 * goes to `to_tsquery`, which throws on stray operator characters. Output is
 * folded because it is matched against content_tsv, which is generated from
 * folded_text.
 */
export function toOrTsQuery(terms: string[]): string {
  const groups = terms
    .map((t) =>
      foldForSearch(t)
        .replace(/[^؀-ۿ\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 1 && !TSQ_STOP.has(w))
    )
    .filter((words) => words.length > 0)
    .map((words) => words.join(" & "));

  return [...new Set(groups)].join(" | ");
}

function buildExpansionPrompt(question: string) {
  return {
    system: `أنت مساعد بحث قانوني أردني. قد يصف المحامي وقائع بلغة عامية أو وصفية، أو
يطرح سؤالاً مفاهيمياً/مقارناً بمصطلح قانوني أكاديمي متعارف عليه في الفقه —
وكلا النوعين قد يستخدم كلمات لا يستخدمها نص القانون نفسه حرفياً (مثال: مصطلح
فقهي شائع مثل "البطلان النسبي" لا يرد بهذا اللفظ في القانون المدني الأردني،
الذي ينظم نفس الفكرة تحت "العقد الموقوف" وعيوب الرضا).

مهمتك: استخرج المصطلحات التشريعية الأردنية التي يُرجَّح ورودها فعلاً في نص
القانون لهذا السؤال أو هذه الوقائع، لتُستخدم في البحث. إن كان السؤال يقارن بين
مفهومين، استخرج مصطلحات لكلا الطرفين، لا لطرف واحد فقط.

أعد JSON فقط بهذا الشكل بلا أي نص آخر:
{"terms": ["مصطلح", "مصطلح"]}

قواعد صارمة:
- من 3 إلى 6 مصطلحات كحد أقصى.
- مصطلحات تشريعية فقط (مثل: "مال مسلم على وجه الأمانة"، "الفعل الضار").
- ممنوع منعاً قطعياً ذكر رقم مادة أو رقم قانون أو رقم قرار — هذه تُسترجع من قاعدة البيانات ولا تُخمَّن.
- لا تُجب عن السؤال، ولا تشرح. مصطلحات البحث فقط.`,
    user: question,
  };
}

function parseTerms(text: string): string[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const o = JSON.parse(m[0]);
    if (!Array.isArray(o.terms)) return [];
    return o.terms
      .filter((t: unknown): t is string => typeof t === "string")
      .map((t: string) => t.trim())
      // A model told not to cite will occasionally do it anyway; a term
      // carrying a number is a fabricated citation leaking into the query.
      .filter((t: string) => t.length >= 3 && t.length <= 60 && !/\d/.test(t))
      .slice(0, 6);
  } catch {
    return [];
  }
}

/**
 * Expands a question for retrieval.
 *
 * @param analysis the rule-tier analysis — only its `queryType` is read, to
 *        decide whether the LLM source is eligible (fact_pattern only).
 */
export async function expandQuery(
  question: string,
  analysis: Pick<QueryAnalysis, "queryType">,
  opts?: { allowLLM?: boolean }
): Promise<Expansion> {
  if (!env.legalQueryExpansion) {
    return { searchText: question, addedTerms: [], orGroup: "", matches: [], source: "none" };
  }

  const { terms: ontologyTerms, matches } = expandWithOntology(question);

  let llmTerms: string[] = [];
  // fact_pattern always pays for the LLM call (lay narrative is where the
  // ontology is most reliably missing a bridge). doctrinal_question only pays
  // for it when the free ontology tier found NOTHING — most doctrinal
  // questions ("ما شروط...", "ما حكم...") are answered fine by vector search
  // alone, but the comparison subset ("ما الفرق بين X و Y؟") is exactly where
  // a scholarly term with no statutory match (see legal-ontology.ts's
  // 2026-07-25 doctrinal cluster and its header comment) needs the same
  // lay↔statute bridge fact_pattern already gets — and a hand-curated table
  // can never cover every such term, so this is the general safety net for
  // whatever the table doesn't have YET, not a substitute for growing it.
  const llmEligible =
    (analysis.queryType === "fact_pattern" || (analysis.queryType === "doctrinal_question" && ontologyTerms.length === 0)) &&
    (opts?.allowLLM ?? env.queryLlmFallback);
  if (llmEligible) {
    try {
      const { system, user } = buildExpansionPrompt(question);
      const provider = getChatProvider();
      const result = await Promise.race([
        provider.chat([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 200 }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("expansion timeout")), LLM_TIMEOUT_MS)),
      ]);
      llmTerms = parseTerms(result.text);
    } catch {
      // Expansion is an optimisation, never a dependency: on timeout or bad
      // JSON the ontology terms (or the bare question) still search fine.
      llmTerms = [];
    }
  }

  // Merge, dropping anything already present in the question.
  const folded = foldForSearch(question);
  const seen = new Set(ontologyTerms.map((t) => foldForSearch(t)));
  const addedTerms = [...ontologyTerms];
  for (const t of llmTerms) {
    const key = foldForSearch(t);
    if (seen.has(key) || folded.includes(key)) continue;
    seen.add(key);
    addedTerms.push(t);
  }

  const capped = addedTerms.slice(0, MAX_TERMS);
  if (capped.length === 0) {
    return { searchText: question, addedTerms: [], orGroup: "", matches, source: "none" };
  }

  const source: Expansion["source"] =
    ontologyTerms.length && llmTerms.length ? "both" : llmTerms.length ? "llm" : "ontology";

  return {
    // The question first so it dominates the embedding; the statutory terms
    // follow as context that pulls the vector toward the corpus's language.
    searchText: `${question} ${capped.join("، ")}`,
    addedTerms: capped,
    orGroup: toOrTsQuery(capped),
    matches,
    source,
  };
}
