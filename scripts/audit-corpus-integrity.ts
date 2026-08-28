/**
 * Read-only diagnostic: does each ingested law's article numbering actually
 * make sense for its size? validateSourceMetadata (ingest/validate.ts) only
 * ever checked IDENTITY metadata — title, number, year, effective date. It
 * has never checked whether the CONTENT was chunked correctly, and nothing
 * else in the pipeline did either.
 *
 * Built after finding — by manual, one-off SQL queries, not by any standing
 * check — that القانون المدني has only 205 distinct article_number values
 * for a code that runs past article 1445, and that the chunk tagged
 * article_number='785' actually contains text spanning at least six real
 * articles (785, 788, 792, 797, 800, 804). chunkLegalText's ARTICLE_RE
 * (chunk.ts) only recognises "المادة N" anchored at the START of a line;
 * this source's extracted text apparently has article markers landing
 * mid-line for long stretches, so the chunker kept stamping every
 * subsequent chunk with the last article number it correctly parsed.
 *
 * FIRST VERSION OF THIS SCRIPT FLAGGED 74 OF 78 SOURCES — nearly useless,
 * because two things it didn't account for turned out to be completely
 * normal, not corruption:
 *   1. Almost every source has exactly one article_number=NULL chunk — a
 *      legitimate preamble/title block before المادة 1 ("قانون العقوبات
 *      وتعديلاته رقم 16 لسنة 1960" as its own chunk), confirmed by reading
 *      the actual text. The 4 sources that DIDN'T have one were the
 *      exception, not the rule.
 *   2. A "معدل" (amending) act legitimately touches only a handful of a
 *      much larger base law's articles — low coverage relative to the
 *      base law's article count is the entire POINT of an amendment, not
 *      a sign it was chunked wrong. isAmendingTitle (already used by
 *      validate.ts) is reused here rather than re-guessing the same
 *      pattern.
 * This version only flags what those two corrections leave: real,
 * structural anomalies in ORIGINAL (non-amending) legislation.
 *
 * Also surfaces is_current_version: a corrupted SUPERSEDED source (found
 * live today — قانون العقوبات وتعديلاته رقم 16 لسنة 1960, source id 3, is
 * corrupted exactly like this, but a clean CURRENT replacement already
 * exists at source id 170) is inert for real queries and low priority.
 * A corrupted CURRENT source is the urgent case.
 *
 * THIRD CALIBRATION BUG, found 2026-07-25 ingesting a 34-file batch of
 * أنظمة/تعليمات (mostly OCR'd, being short administrative regulations):
 * almost all of them tripped the null-article-count flag, at 100% —
 * EVERY chunk. Root cause is not corruption: pipeline.ts deliberately
 * stores article_number as NULL for any OCR'd source (`trustNumbers =
 * extracted.method !== "ocr"`) because tesseract misreads Arabic-Indic
 * digits, and a wrong citation number is worse than none. The chunker
 * still finds real article boundaries during OCR — that number survives
 * in each chunk's `metadata.article_number_ocr_unverified` — it is just
 * never promoted to the trusted column. The null-count/coverage checks
 * now read `COALESCE(article_number, article_number_ocr_unverified)` so
 * an OCR'd source is judged on whether the chunker found real structure,
 * not on whether the DELIBERATE citation-safety gate nulled it out.
 *
 * Changes nothing — pure SELECT queries — so it is safe to run at any
 * time, repeatedly.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/audit-corpus-integrity.ts
 */
import "dotenv/config";
import { query } from "../src/lib/db";
import { isAmendingTitle } from "../src/lib/ingest/law-identity";

// Charged only against law/regulation/instruction sources: article_number is
// a meaningful concept there. Court decisions/principles/templates chunk by
// sliding window (chunk.ts's chunkByWindow) and legitimately have NULL
// article_number on every chunk — including them would just report "100%
// NULL" for a reason that has nothing to do with corruption.
const ARTICLE_BASED_TYPES = ["law", "regulation", "instruction"];

// Common enough in ANY reasonably long stretch of Arabic legal prose that a
// text corrupted at the letter level (OCR substitution — the exact pattern
// found today: "عاى" for "على", "اهاية" for "نهاية") will under-produce them,
// since the corruption hits these words too, just as often as any other.
// Deliberately not a list of the SPECIFIC corrupted forms seen today — that
// would only catch a repeat of this one document's exact corruption
// signature, not the general phenomenon.
const COMMON_STOPWORDS = ["على", "من", "في", "الذي", "التي", "هذا", "إذا", "يجب"];

// Below this, a density estimate is noise, not signal — a handful of short,
// list-heavy procedural chunks can legitimately have few flowing-prose
// stopwords. Only judged once there is enough sampled text to mean anything.
const MIN_SAMPLE_CHARS = 1500;

type SourceRow = {
  id: number;
  title: string;
  is_current_version: boolean;
  chunk_count: string;
  distinct_numeric_articles: string;
  null_article_count: string;
  non_numeric_article_count: string;
  min_numeric_article: string | null;
  max_numeric_article: string | null;
};

function stopwordDensity(text: string): number | null {
  if (text.length < MIN_SAMPLE_CHARS) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let hits = 0;
  for (const w of words) if (COMMON_STOPWORDS.includes(w)) hits++;
  return hits / words.length;
}

async function main() {
  // COALESCE(article_number, ...ocr_unverified): the trusted column is
  // deliberately NULL for every chunk of an OCR'd source (pipeline.ts's
  // anti-hallucination gate on misread digits) — judging structure by that
  // column alone would flag 100% of OCR'd sources regardless of quality.
  // The unverified value reflects what the chunker actually found.
  const sources = await query<SourceRow>(
    `SELECT s.id, s.title, s.is_current_version,
            COUNT(d.id) AS chunk_count,
            COUNT(DISTINCT COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified'))
              FILTER (WHERE COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') ~ '^[0-9]+$') AS distinct_numeric_articles,
            COUNT(*) FILTER (WHERE COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') IS NULL) AS null_article_count,
            COUNT(*) FILTER (WHERE COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') IS NOT NULL
                             AND COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') !~ '^[0-9]+$') AS non_numeric_article_count,
            MIN(COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified')::int)
              FILTER (WHERE COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') ~ '^[0-9]+$') AS min_numeric_article,
            MAX(COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified')::int)
              FILTER (WHERE COALESCE(d.article_number, d.metadata->>'article_number_ocr_unverified') ~ '^[0-9]+$') AS max_numeric_article
       FROM legal_sources s
       JOIN legal_documents d ON d.source_id = s.id
      WHERE s.source_type = ANY($1) AND s.status = 'ready'
      GROUP BY s.id, s.title, s.is_current_version
      HAVING COUNT(d.id) > 0`,
    [ARTICLE_BASED_TYPES]
  );

  type Report = {
    id: number;
    title: string;
    isCurrent: boolean;
    isAmendment: boolean;
    chunkCount: number;
    distinctArticles: number;
    nullCount: number;
    minArticle: number | null;
    maxArticle: number | null;
    coverageRatio: number | null;
    stopwordDensity: number | null;
    flags: string[];
  };

  const reports: Report[] = [];

  for (const s of sources) {
    const chunkCount = Number(s.chunk_count);
    const distinctArticles = Number(s.distinct_numeric_articles);
    const nullCount = Number(s.null_article_count);
    const minArticle = s.min_numeric_article !== null ? Number(s.min_numeric_article) : null;
    const maxArticle = s.max_numeric_article !== null ? Number(s.max_numeric_article) : null;
    const isAmendment = isAmendingTitle(s.title);

    // Relative to the SPAN this source's own articles actually cover
    // (max-min+1), not "1 to max" — a source that is only ONE CHAPTER of a
    // larger document (الدستور الأردني is split into 10 per-chapter sources,
    // الفصل01..الفصل10) legitimately only contains a narrow high-numbered
    // range of the full document's numbering, and dividing by the absolute
    // max would make a perfectly healthy chapter file look like it was
    // missing 90%+ of its content for no reason but how it was split.
    const span = minArticle !== null && maxArticle !== null ? maxArticle - minArticle + 1 : null;
    const coverageRatio = span && span > 0 ? distinctArticles / span : null;

    const sample = await query<{ chunk_text: string }>(
      `SELECT chunk_text FROM legal_documents WHERE source_id = $1 ORDER BY id LIMIT 60`,
      [s.id]
    );
    const combinedText = sample.map((r) => r.chunk_text).join(" ");
    const density = stopwordDensity(combinedText);

    const flags: string[] = [];
    // Coverage/collapsed-article checks only mean something for a COMPLETE
    // original law — an amendment legitimately covers a handful of articles
    // out of a much larger base law's numbering, by design.
    if (!isAmendment) {
      if (coverageRatio !== null && coverageRatio < 0.4) {
        flags.push(`coverage=${(coverageRatio * 100).toFixed(0)}% of its own article span ${minArticle}-${maxArticle} (<40% — likely collapsed/mislabeled chunks)`);
      }
      // A single preamble/title chunk is normal (confirmed by reading several
      // directly) — only real signal is MORE than that, or a large fraction
      // of the source's chunks carrying no number at all.
      if (nullCount > 2 && chunkCount > 0 && nullCount / chunkCount > 0.05) {
        flags.push(`${nullCount}/${chunkCount} chunks with no article_number (>5%, >2 absolute)`);
      }
    }
    if (density !== null && density < 0.03) {
      flags.push(`stopword density=${(density * 100).toFixed(2)}% across a real text sample — well below the ~7-11% healthy laws show (possible OCR corruption)`);
    }

    reports.push({
      id: s.id,
      title: s.title,
      isCurrent: s.is_current_version,
      isAmendment,
      chunkCount,
      distinctArticles,
      nullCount,
      minArticle,
      maxArticle,
      coverageRatio,
      stopwordDensity: density,
      flags,
    });
  }

  // Worst first: current + flagged (urgent) before superseded + flagged
  // (inert, lower priority) before clean.
  reports.sort((a, b) => {
    const aFlagged = a.flags.length > 0;
    const bFlagged = b.flags.length > 0;
    if (aFlagged !== bFlagged) return aFlagged ? -1 : 1;
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.flags.length - a.flags.length;
  });

  const suspect = reports.filter((r) => r.flags.length > 0);
  const clean = reports.filter((r) => r.flags.length === 0);

  console.log(`\n${"=".repeat(78)}`);
  console.log(`  CORPUS INTEGRITY AUDIT — ${reports.length} law/regulation/instruction source(s)`);
  console.log(`  (${reports.filter((r) => r.isAmendment).length} identified as amending acts — coverage/null checks skipped for those)`);
  console.log(`${"=".repeat(78)}\n`);

  console.log(`SUSPECT (${suspect.length}) — current/live sources first, worst within each:\n`);
  for (const r of suspect) {
    const marker = r.isCurrent ? "🔴 CURRENT — affects live answers" : "⚪ superseded — inert unless a historical query asks for it";
    console.log(`[source ${r.id}] ${r.title}  ${r.isAmendment ? "(amending act)" : ""}`);
    console.log(`    ${marker}`);
    console.log(
      `    chunks=${r.chunkCount}  distinct_articles=${r.distinctArticles}  article_range=${r.minArticle ?? "n/a"}-${r.maxArticle ?? "n/a"}` +
        (r.stopwordDensity !== null ? `  stopword_density=${(r.stopwordDensity * 100).toFixed(2)}%` : "")
    );
    for (const f of r.flags) console.log(`    ⚠ ${f}`);
    console.log();
  }

  console.log(`\nCLEAN (${clean.length}):\n`);
  for (const r of clean) {
    console.log(
      `[source ${r.id}]${r.isAmendment ? " (amending act)" : ""} ${r.title}  —  chunks=${r.chunkCount} ` +
        `distinct_articles=${r.distinctArticles}` +
        (r.coverageRatio !== null ? `  coverage=${(r.coverageRatio * 100).toFixed(0)}%` : "")
    );
  }

  console.log(`\n${"=".repeat(78)}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
