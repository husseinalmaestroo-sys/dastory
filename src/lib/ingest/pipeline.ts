import "server-only";
import { query, transaction, toVector } from "../db";
import { getEmbeddingProvider } from "../ai";
import { extractDocument } from "./extract";
import { cleanText, foldForSearch } from "./clean";
import { chunkLegalText } from "./chunk";
import { extractDecisionMeta, extractLawName } from "./metadata";
import { parseLawNumber } from "./law-identity";
import { stemArabicText } from "../search/arabic-stem";

export type IngestInput = {
  sourceId: number;
  filePath: string;
  title: string;
  sourceType: string;
  category?: string | null;
  court?: string | null;
  year?: number | null;
};

export type IngestResult = {
  chunks: number;
  pages: number;
  method: string;
  embeddingTokens: number;
};

/**
 * PDF → text → clean → chunks → embeddings → Postgres.
 *
 * Runs to completion in one call and is safe to re-run: a re-index deletes the
 * source's old chunks inside the same transaction that writes the new ones, so
 * the corpus is never half-old/half-new to a concurrent search.
 */
export async function ingestSource(input: IngestInput): Promise<IngestResult> {
  const provider = getEmbeddingProvider();

  await query(`UPDATE legal_sources SET status = 'processing', error = NULL, updated_at = now() WHERE id = $1`, [
    input.sourceId,
  ]);

  try {
    const extracted = await extractDocument(input.filePath);
    const text = cleanText(extracted.text);

    if (text.length < 50) {
      throw new Error("لم يتم استخراج نص كافٍ من الملف. قد يكون الملف فارغاً أو صورة غير مقروءة.");
    }

    const chunks = chunkLegalText(text, { sourceType: input.sourceType });
    if (chunks.length === 0) throw new Error("لم ينتج عن الملف أي مقاطع قابلة للفهرسة.");

    /**
     * OCR reads Arabic prose well (~86% confidence on Gazette scans) but
     * misreads Arabic-Indic digits badly — "المادة ٣" comes back as "المادة ov"
     * or "المادة *-". Tested with both ara and ara+eng; neither is reliable.
     *
     * So OCR'd citation numbers do not become citation data. The whole system
     * rests on never fabricating a citation, and an article number recovered
     * by guesswork *is* a fabricated citation — worse than none, because it
     * looks authoritative on the source card.
     *
     * The prose still gets embedded and is fully searchable by meaning; only
     * the precise numbers are withheld, and the admin is told why.
     */
    const trustNumbers = extracted.method !== "ocr";

    const isDecision = input.sourceType === "court_decision";
    const meta = isDecision && trustNumbers ? extractDecisionMeta(text) : null;
    const lawName = isDecision ? null : extractLawName(text, input.title);
    // Denormalised onto each chunk beside law_name, so a retrieved article
    // carries "قانون العمل رقم 8" without a join. Parsed from the title, and
    // only for legislation — a decision has no law number.
    const lawNumber = isDecision ? null : parseLawNumber(input.title);

    const note = trustNumbers
      ? (extracted.note ?? null)
      : [
          extracted.note,
          "أرقام المواد وأرقام القرارات المستخرجة من هذا الملف غير موثوقة لأن النص قُرئ ضوئياً (OCR)، لذلك لم تُخزَّن كبيانات استشهاد. النص قابل للبحث الدلالي. لاستشهاد دقيق بالمواد، ارفع نسخة رقمية سليمة من الملف.",
        ]
          .filter(Boolean)
          .join(" ");

    // The admin's explicit input always beats the regex guess.
    const court = input.court ?? meta?.court ?? null;
    const year = input.year ?? meta?.year ?? null;

    const { embeddings, tokens } = await provider.embed(chunks.map((c) => c.text), "document");
    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: got ${embeddings.length} for ${chunks.length} chunks.`);
    }

    await transaction(async (client) => {
      await client.query(`DELETE FROM legal_documents WHERE source_id = $1`, [input.sourceId]);

      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        await client.query(
          `INSERT INTO legal_documents
             (source_id, chunk_index, chunk_text, folded_text, stemmed_text, extracted_text, embedding,
              article_number, law_name, law_number, part, chapter, section,
              court, decision_number, year, category, keywords, legal_topics,
              decision_section, proves_chunk_index, metadata, embedding_model)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            input.sourceId,
            i,
            c.text,
            foldForSearch(c.text),
            // stemmed_text wants ta-marbuta still intact (see arabic-stem.ts),
            // so it is built from c.text directly, NOT from folded_text above.
            stemArabicText(c.text),
            // Parent text only on chunk 0: storing it on all N chunks would
            // multiply the table size by N for zero retrieval benefit.
            i === 0 ? text : null,
            toVector(embeddings[i]),
            trustNumbers ? c.articleNumber : null,
            lawName,
            lawNumber,
            c.part,
            c.chapter,
            c.section,
            court,
            meta?.decisionNumber ?? null,
            year,
            input.category ?? null,
            c.keywords,
            c.legalTopics,
            c.decisionSection,
            c.provesChunkIndex,
            JSON.stringify({
              source_title: input.title,
              source_type: input.sourceType,
              extraction_method: extracted.method,
              pages: extracted.pages,
              // Kept for the admin to eyeball against the original, never read
              // by search or shown as a citation.
              ...(trustNumbers ? {} : { article_number_ocr_unverified: c.articleNumber }),
            }),
            // Which model produced this vector (Phase 2 embedding versioning):
            // retrieval only compares a query with vectors of its own model.
            provider.model,
          ]
        );
      }

      if (isDecision) {
        await client.query(`DELETE FROM court_cases WHERE source_id = $1`, [input.sourceId]);
        await client.query(
          `INSERT INTO court_cases
             (source_id, case_number, court_name, case_type, year, decision_text, legal_principle, keywords)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            input.sourceId,
            meta?.decisionNumber ?? null,
            court,
            input.category ?? null,
            year,
            text,
            meta?.legalPrinciple ?? null,
            chunks.flatMap((c) => c.keywords).slice(0, 20),
          ]
        );
      }

      await client.query(
        `UPDATE legal_sources
            SET status = 'ready', chunk_count = $2, court = COALESCE(court, $3),
                year = COALESCE(year, $4), error = NULL, note = $5, updated_at = now()
          WHERE id = $1`,
        [input.sourceId, chunks.length, court, year, note]
      );
    });

    return {
      chunks: chunks.length,
      pages: extracted.pages,
      method: extracted.method,
      embeddingTokens: tokens,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(`UPDATE legal_sources SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [
      input.sourceId,
      message.slice(0, 500),
    ]);
    throw err;
  }
}

/** Re-runs ingest for an existing source (admin "rebuild embeddings"). */
export async function reindexSource(sourceId: number): Promise<IngestResult> {
  const rows = await query<{
    id: number;
    file_path: string | null;
    title: string;
    source_type: string;
    category: string | null;
    court: string | null;
    year: number | null;
  }>(`SELECT id, file_path, title, source_type, category, court, year FROM legal_sources WHERE id = $1`, [sourceId]);

  const src = rows[0];
  if (!src) throw new Error(`Source ${sourceId} not found.`);
  if (!src.file_path) throw new Error(`Source ${sourceId} has no stored file to re-index.`);

  return ingestSource({
    sourceId: src.id,
    filePath: src.file_path,
    title: src.title,
    sourceType: src.source_type,
    category: src.category,
    court: src.court,
    year: src.year,
  });
}
