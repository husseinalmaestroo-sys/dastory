/**
 * Loads the SYNTHETIC evaluation corpus (eval/fixtures/corpus.json) through
 * the real ingestion pipeline (clean → chunk → embed → insert), marked
 * is_synthetic = true / provenance = 'synthetic'. Idempotent: an existing
 * synthetic source with the same title is replaced.
 *
 *   EMBEDDING_PROVIDER=test DATABASE_URL=... \
 *     npx tsx --tsconfig scripts/tsconfig.verify.json scripts/load-eval-fixtures.ts
 *
 * Never run against production: it refuses when NODE_ENV=production unless
 * ALLOW_TEST_PROVIDERS=true, and retrieval only serves these rows when
 * ALLOW_SYNTHETIC_CORPUS=true.
 */
import "dotenv/config";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { query, queryOne, getPool } from "../src/lib/db";
import { ingestSource } from "../src/lib/ingest/pipeline";
import { parseLawNumber } from "../src/lib/ingest/law-identity";

type FixtureSource = {
  key: string;
  title: string;
  source_type: string;
  is_current_version: boolean;
  effective_date: string | null;
  jurisdiction?: string;
  court?: string;
  year?: number;
  /** Phase 2.1: a fixture can be loaded quarantined (a damaged text retrieval must never serve). */
  integrity_status?: "verified" | "unverified" | "quarantined";
  text: string;
};

export async function loadEvalFixtures(opts: { quiet?: boolean } = {}): Promise<Record<string, number>> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_PROVIDERS !== "true") {
    throw new Error("Refusing to load synthetic fixtures with NODE_ENV=production.");
  }
  const corpus = JSON.parse(readFileSync(resolve(__dirname, "../eval/fixtures/corpus.json"), "utf8")) as { sources: FixtureSource[] };
  const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
  const ids: Record<string, number> = {};
  try {
    for (const s of corpus.sources) {
      await query(`DELETE FROM legal_sources WHERE title = $1 AND is_synthetic = true`, [s.title]);
      const row = await queryOne<{ id: string }>(
        `INSERT INTO legal_sources
           (title, source_type, court, year, status, law_number, effective_date, is_current_version,
            jurisdiction, language, provenance, is_synthetic, acquired_at, issuing_authority, note, integrity_status)
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,'ar','synthetic',true,now(),'SYNTHETIC — evaluation fixture',
                 'مصدر اصطناعي لأغراض الاختبار فقط — ليس قانوناً أردنياً',$9)
         RETURNING id`,
        [
          s.title,
          s.source_type,
          s.court ?? null,
          s.year ?? null,
          s.source_type === "court_decision" ? null : parseLawNumber(s.title),
          s.effective_date,
          s.is_current_version,
          s.jurisdiction ?? "JO",
          s.integrity_status ?? "unverified",
        ]
      );
      const id = Number(row!.id);
      const file = join(dir, `${s.key}.txt`);
      writeFileSync(file, s.text, "utf8");
      const res = await ingestSource({ sourceId: id, filePath: file, title: s.title, sourceType: s.source_type, court: s.court ?? null, year: s.year ?? null });
      ids[s.key] = id;
      if (!opts.quiet) console.log(`  ${s.key.padEnd(16)} id=${id} chunks=${res.chunks}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return ids;
}

if (require.main === module) {
  loadEvalFixtures()
    .then(() => getPool().end())
    .catch((err) => {
      console.error("Fixture load failed:", err);
      process.exit(1);
    });
}
