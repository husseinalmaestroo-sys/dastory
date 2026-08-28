/**
 * Bulk-ingests a folder of legal documents (.pdf and .txt). Built for the real
 * job: a few hundred laws and decisions in folders, not one upload at a time.
 *
 *   npm run ingest -- <folder> [options]
 *
 * Options:
 *   --type=<law|regulation|instruction|court_decision|principle|template>
 *                      Force one type for the whole batch. Omit it to let
 *                      classify.ts read the type from each filename — required
 *                      for a mixed batch (moj.gov.jo files أنظمة and تعليمات
 *                      under one section). If a filename says nothing, the run
 *                      STOPS and asks: it will not guess.
 *   --title-prefix=<s> Prepended to every title. For sources whose filenames
 *                      carry no meaning — the Constitution ships as
 *                      الفصل01..الفصل10.
 *   --category=<...>   حقوقية | جزائية | عمالية | ...
 *   --court=<...>      محكمة التمييز | ...
 *   --year=<YYYY>      Overrides the year parsed from each title.
 *   --law-number=<N>   The law's number (رقم N). Overrides what is parsed from
 *                      the title. REQUIRED for law/regulation/instruction when
 *                      the title carries no "رقم N".
 *   --effective-date=<YYYY-MM-DD>
 *                      تاريخ النفاذ. REQUIRED for law/regulation/instruction —
 *                      it cannot be inferred from a title, so it is given here.
 *   --amends=<id>      This whole batch amends the base law with this source id.
 *                      REQUIRED when a title is an amending act ("قانون معدّل
 *                      لقانون …"), so the amendment is linked, not duplicated.
 *                      Use one law per run when passing this.
 *   --dry-run          Plan + cost estimate. Writes nothing, calls nothing,
 *                      and works without a reachable database.
 *   --force            Re-ingest files already indexed by content hash.
 *   --limit=<n>        Stop after n files. Use it to price a batch first.
 *
 * Legislation (law | regulation | instruction) is validated before ingest:
 * name, number, year, type and effective date are mandatory, and an amending
 * act must be linked to its base. The run STOPS and lists what to pass rather
 * than embedding a half-identified, uncitable statute. Court decisions,
 * principles and templates need only a title and type.
 *
 * Examples:
 *   npm run ingest -- ./downloads/moj-laws --type=law --dry-run
 *   npm run ingest -- ./downloads/moj-regs                    # mixed: no --type
 *   npm run ingest -- ./downloads/moj-dustour --type=law --title-prefix="الدستور الأردني"
 *   # a base law (number+year parsed from the title, effective date supplied):
 *   npm run ingest -- ./downloads/tijara --type=law --effective-date=1966-01-01
 *   # an amending act, linked to the base law that is source id 3:
 *   npm run ingest -- ./downloads/uqubat-2022 --type=law --amends=3 --effective-date=2022-05-16
 *
 * Safe to interrupt: every file is committed on its own, and a re-run skips
 * whatever already succeeded. Ctrl+C costs you the file in flight, nothing more.
 */
import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { ingestSource } from "../src/lib/ingest/pipeline";
import { titleFromPath, pickBestTitled } from "../src/lib/ingest/title";
import { classifySource, SOURCE_TYPES } from "../src/lib/ingest/classify";
import { parseLawNumber, parseLawYear } from "../src/lib/ingest/law-identity";
import { validateSourceMetadata } from "../src/lib/ingest/validate";
import { estimateCost } from "../src/lib/ai/pricing";

type Opts = {
  folder: string;
  type: string | null;
  titlePrefix: string | null;
  category: string | null;
  court: string | null;
  year: number | null;
  lawNumber: string | null;
  effectiveDate: string | null;
  amends: number | null;
  dryRun: boolean;
  force: boolean;
  limit: number | null;
};


function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith("--"));
  if (!folder) {
    console.error("Usage: bulk-ingest.ts <folder> [--type=...] [--category=...] [--dry-run]");
    process.exit(1);
  }

  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? null;
  const type = get("type");
  if (type && !SOURCE_TYPES.includes(type as any)) {
    console.error(`Invalid --type. One of: ${SOURCE_TYPES.join(", ")}`);
    process.exit(1);
  }

  const yearRaw = get("year");
  const limitRaw = get("limit");
  const amendsRaw = get("amends");

  return {
    folder: resolve(folder),
    type,
    titlePrefix: get("title-prefix"),
    category: get("category"),
    court: get("court"),
    year: yearRaw ? Number(yearRaw) : null,
    lawNumber: get("law-number"),
    effectiveDate: get("effective-date"),
    amends: amendsRaw ? Number(amendsRaw) : null,
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    limit: limitRaw ? Number(limitRaw) : null,
  };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`  ! cannot read ${dir}: ${(err as Error).message}`);
    return out;
  }

  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if ([".pdf", ".txt"].includes(extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  const opts = parseArgs();

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!opts.dryRun && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — ingest calls the embedding API.");
  }

  const st = await stat(opts.folder).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`Not a folder: ${opts.folder}`);

  console.log(`\nScanning ${opts.folder} ...`);
  let files = await walk(opts.folder);
  console.log(`Found ${files.length} document(s) (.pdf, .txt).`);
  if (files.length === 0) return;

  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));

  // Hash everything up front so the plan printed below is the real plan —
  // dry-run must not lie about what it would skip.
  console.log("Hashing for duplicates ...");

  // A dry run's job is to let you size and price a batch before committing to
  // anything, which is exactly when the database may not be reachable yet.
  // Degrade to "nothing is indexed" rather than refusing to plan; a real run
  // still fails loudly, because there it would silently re-embed duplicates.
  let known = new Set<string>();
  try {
    const { rows } = await pool.query<{ file_hash: string }>(
      `SELECT file_hash FROM legal_sources WHERE file_hash IS NOT NULL AND status = 'ready'`
    );
    known = new Set(rows.map((r) => r.file_hash));
  } catch (err) {
    if (!opts.dryRun) throw err;
    console.warn(`  ! database unreachable (${(err as Error).message})`);
    console.warn(`  ! dry run continues assuming an empty knowledge base — the`);
    console.warn(`    "skipped" count below may be understated.\n`);
  }

  type Candidate = {
    path: string;
    hash: string;
    type: string | null;
    title: string;
    bytes: number;
    basis: string;
    lawNumber: string | null;
    year: number | null;
    effectiveDate: string | null;
  };

  // Group by hash first, then pick a representative — rather than keeping
  // whichever copy the directory walk happened to reach first. With
  // "qarar_1234_2020.pdf" and "DUPLICATE_copy.pdf" holding identical bytes,
  // first-wins is decided by filename order and routinely keeps the junk name.
  // The title ends up in the admin table and in every citation, so it matters.
  const byHash = new Map<string, Candidate[]>();
  for (const f of files) {
    const hash = await sha256(f);
    const { type, basis } = classifySource(f, opts.type);
    const base = titleFromPath(f);
    const title = opts.titlePrefix ? `${opts.titlePrefix} — ${base}` : base;
    const c: Candidate = {
      path: f,
      hash,
      type,
      basis,
      // For sources whose filenames carry no meaning of their own — the
      // Constitution ships as الفصل01..الفصل10 — the prefix is what makes the
      // citation card readable.
      title,
      bytes: (await stat(f)).size,
      // CLI flag wins; otherwise read the number/year out of the title. The
      // effective date cannot be inferred from a title, so it is CLI-only —
      // and validation below will refuse legislation that lacks it.
      lawNumber: opts.lawNumber ?? parseLawNumber(title),
      year: opts.year ?? parseLawYear(title),
      effectiveDate: opts.effectiveDate,
    };
    const list = byHash.get(hash);
    if (list) list.push(c);
    else byHash.set(hash, [c]);
  }

  const planned: Candidate[] = [];
  let skipped = 0;

  // Sorted for a stable plan: the same folder must produce the same output
  // twice, or a resumed run is not reproducible.
  for (const [hash, group] of [...byHash.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    skipped += group.length - 1; // the copies we collapse away
    if (!opts.force && known.has(hash)) {
      skipped++;
      continue;
    }
    planned.push(pickBestTitled(group));
    if (opts.limit && planned.length >= opts.limit) break;
  }

  const totalBytes = planned.reduce((s, p) => s + p.bytes, 0);
  // ~1 token per 3 chars of Arabic, and a rough 1 char per 2 bytes of PDF once
  // markup is stripped. Deliberately crude — it is a budget sanity check, not
  // an invoice. Real cost is recorded per source after ingest.
  const estTokens = Math.round((totalBytes / 2) / 3);
  const estUsd = estimateCost(process.env.EMBEDDING_MODEL ?? "text-embedding-3-small", estTokens, 0);

  console.log(`\n${"=".repeat(58)}`);
  console.log(`  to ingest : ${planned.length}`);
  console.log(`  skipped   : ${skipped} (already indexed)`);
  console.log(`  size      : ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  est. cost : ~$${estUsd.toFixed(3)}  (~${estTokens.toLocaleString("en-US")} embedding tokens, rough)`);
  console.log(`${"=".repeat(58)}\n`);

  const byType = planned.reduce<Record<string, number>>((acc, p) => {
    const k = p.type ?? "UNKNOWN";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  console.log("  by type:", byType, "\n");

  // Stop rather than guess. A misfiled source is worse than an unfiled one:
  // it drives the sourceType search filter and the chunking strategy, so it
  // ends up indexed but invisible to the queries meant to find it — and
  // nothing errors to tell you.
  const unknown = planned.filter((p): p is Candidate & { type: null } => p.type === null);
  if (unknown.length > 0) {
    console.error(`Cannot determine the type of ${unknown.length} file(s) from their names:\n`);
    for (const u of unknown.slice(0, 10)) console.error(`  ${u.title}`);
    if (unknown.length > 10) console.error(`  ... and ${unknown.length - 10} more`);
    console.error(`\nPass --type=<${SOURCE_TYPES.join("|")}> to set it for this batch.`);
    await pool.end();
    process.exit(1);
  }

  // Metadata gate. Same rule as the admin upload path (validate.ts): a law,
  // regulation, or instruction must carry name + number + year + effective
  // date, and an amending act must be linked to its base. A missing number is
  // an uncitable, unfindable law — worse than not ingesting it — so we stop and
  // say exactly what to pass, rather than embedding a batch of half-identified
  // statutes. Non-legislation (court decisions, principles, templates) only
  // needs a title and type and passes straight through.
  const invalid = planned
    .map((p) => ({
      p,
      result: validateSourceMetadata({
        title: p.title,
        sourceType: p.type,
        lawNumber: p.lawNumber,
        year: p.year,
        effectiveDate: p.effectiveDate,
        amendmentOf: opts.amends,
      }),
    }))
    .filter((x) => !x.result.ok);

  if (invalid.length > 0) {
    console.error(`\n${invalid.length} file(s) fail metadata validation and will NOT be ingested:\n`);
    for (const { p, result } of invalid.slice(0, 10)) {
      console.error(`  [${p.type}] ${p.title.slice(0, 56)}`);
      for (const e of result.errors) console.error(`      - ${e}`);
    }
    if (invalid.length > 10) console.error(`  ... and ${invalid.length - 10} more`);
    console.error(
      `\nSupply the missing fields for this batch:\n` +
        `  --law-number=<N>  --year=<YYYY>  --effective-date=<YYYY-MM-DD>  [--amends=<baseSourceId>]\n` +
        `(number and year are read from each title when present; the effective date must be given.)`
    );
    await pool.end();
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log("Dry run — nothing was written. Sample of what would be ingested:\n");
    for (const p of planned.slice(0, 15)) {
      // Print the basis too: "folder" means the verdict came from the weakest
      // signal and deserves a second look before you spend money on it. The
      // number/year columns show what validation parsed from each title.
      const id = [p.lawNumber ? `رقم ${p.lawNumber}` : null, p.year ?? null].filter(Boolean).join(" / ") || "—";
      console.log(`  [${String(p.type).padEnd(14)}] ${p.title.slice(0, 40).padEnd(42)} ${id.padEnd(16)} (${p.basis})`);
    }
    if (planned.length > 15) console.log(`  ... and ${planned.length - 15} more`);
    await pool.end();
    return;
  }

  let ok = 0;
  let failed = 0;
  const failures: { title: string; error: string }[] = [];
  const startedAt = Date.now();

  for (const [i, p] of planned.entries()) {
    const label = `[${i + 1}/${planned.length}] ${p.title.slice(0, 55)}`;
    process.stdout.write(`${label.padEnd(70)}`);

    try {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO legal_sources
           (title, source_type, category, court, year, law_number, effective_date, amendment_of,
            file_path, file_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING id`,
        [p.title, p.type, opts.category, opts.court, p.year, p.lawNumber, p.effectiveDate, opts.amends, p.path, p.hash]
      );

      const result = await ingestSource({
        sourceId: rows[0].id,
        filePath: p.path,
        title: p.title,
        // Non-null: the batch aborts above if any file is unclassified.
        sourceType: p.type!,
        category: opts.category,
        court: opts.court,
        // Per-file year (CLI override, else parsed from the title), not the
        // batch-wide opts.year — a folder of laws spans many years.
        year: p.year,
      });

      ok++;
      console.log(`ok  ${String(result.chunks).padStart(4)} chunks  ${result.method}`);
    } catch (err) {
      failed++;
      const msg = (err as Error).message;
      failures.push({ title: p.title, error: msg });
      console.log(`FAIL  ${msg.slice(0, 40)}`);
      // Keep going. One malformed PDF in a batch of 300 must not end the run —
      // the row is left as status='failed' and shows up in /admin for a retry.
    }
  }

  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\n${"=".repeat(58)}`);
  console.log(`  ${ok} ingested, ${failed} failed, in ${mins} min`);
  console.log(`${"=".repeat(58)}`);

  if (failures.length) {
    console.log(`\nFailures (also visible in /admin with status "فشل"):`);
    for (const f of failures.slice(0, 20)) console.log(`  - ${f.title}\n      ${f.error}`);
    if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  }

  const { rows: totals } = await pool.query<{ sources: string; chunks: string }>(
    `SELECT (SELECT COUNT(*) FROM legal_sources WHERE status='ready')::text AS sources,
            (SELECT COUNT(*) FROM legal_documents)::text AS chunks`
  );
  console.log(`\nKnowledge base now: ${totals[0].sources} sources, ${totals[0].chunks} indexed chunks.`);

  await pool.end();
}

main().catch((err) => {
  console.error("\nBulk ingest failed:", err.message);
  process.exit(1);
});
