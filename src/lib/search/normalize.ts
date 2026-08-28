import "server-only";
import { cleanText } from "../ingest/clean";

/**
 * Query normalization — the first stage of retrieval, applied to the
 * lawyer's raw question before intent parsing, expansion, or embedding ever
 * see it.
 *
 * WHY THIS WAS MISSING
 *
 * `ingest/clean.ts`'s `cleanText` (NFKC normalize — which also splits
 * presentation-form ligatures a copy-paste can carry, strips diacritics/
 * tatweel/zero-width marks, normalises Arabic-Indic digits, collapses
 * whitespace, rejoins hard-wrapped lines) runs on every chunk of every
 * ingested document before it is embedded. The QUESTION never went through
 * the same treatment — it was embedded and folded exactly as typed. A
 * question pasted from a Word document or WhatsApp commonly carries
 * diacritics, non-breaking spaces, or Arabic-Indic digits ("المادة ٥") that
 * the corpus text does not, so the two sides of a cosine comparison were not
 * on equal orthographic footing before this.
 *
 * Deliberately NOT `foldForSearch` here. Folding (ة/ه, ى/ي, أ/إ/آ/ا) changes
 * actual letters — correct for the keyword arm's `folded_text`/`content_tsv`,
 * where the same folding was already applied at ingest, but WRONG for the
 * text handed to the embedding model: `pipeline.ts` embeds each chunk's
 * verbatim, UNFOLDED text, so the query must stay unfolded too, or the
 * embedded string stops matching the orthographic form the corpus vectors
 * were actually built from. Folding is applied separately, downstream, only
 * where folded text is actually being compared (the keyword arm, the
 * ontology/topic matchers) — never before embedding.
 *
 * Idempotent — safe to call more than once on the same string (e.g. once at
 * the route entry point, once defensively inside hybridSearch for a caller
 * that did not go through the route) — cleanText applied twice to already
 * -clean text is a no-op.
 */
export function normalizeQuery(question: string): string {
  return cleanText(question).trim();
}
