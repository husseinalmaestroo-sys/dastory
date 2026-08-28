/**
 * Backfills law identity + amendment links onto legislation ALREADY in the
 * corpus.
 *
 * The 24 laws ingested before amendment-linking existed sit in legal_sources
 * as unrelated rows: "قانون العقوبات وتعديلاته رقم 16 لسنة 1960" and "قانون
 * معدل لقانون العقوبات رقم 10 لسنة 2022" have no link between them, so a search
 * for an amended article returns original and amended text with nothing marking
 * which is in force. This script closes that gap for the existing data:
 *
 *   • parses law_number + year from every legislation title (law-identity.ts),
 *   • for each amending act ("قانون معدّل لقانون X"), finds the base law X in
 *     the corpus by NAME and sets amendment_of,
 *   • reports amendments whose base is NOT in the corpus (their link stays
 *     NULL — an honest gap, not a guess).
 *
 * Dry-run by default: prints the plan and writes nothing. Pass --apply to
 * commit. Matching is by folded name and refuses to guess when a base is
 * ambiguous or absent — consistent with the rest of the pipeline, an unsure
 * answer is a reported gap, never a fabricated link.
 *
 *   npx tsx scripts/link-amendments.ts            # plan only
 *   npx tsx scripts/link-amendments.ts --apply    # write the links
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
import { foldForSearch } from "../src/lib/ingest/clean";
import { isAmendingTitle, parseLawNumber, parseLawYear, baseLawName } from "../src/lib/ingest/law-identity";

type Row = {
  id: number;
  title: string;
  source_type: string;
  law_number: string | null;
  year: number | null;
  amendment_of: number | null;
};

/**
 * Base name folded and stripped of the "وتعديلاته … رقم … لسنة …" tail, so an
 * amendment's parsed base name matches the base law's own title regardless of
 * the number/year each carries. The token guard is `(?![؀-ۿ])`, NOT `\b` — a
 * `\b` after the Arabic م of رقم never matches, which silently left every base
 * that lacks "وتعديلاته" (e.g. نظام المساعدة القانونية رقم 119) un-stripped and
 * therefore unmatched. The dry-run caught it.
 */
function baseKey(title: string): string {
  const folded = foldForSearch(title);
  return folded
    .replace(/\s*وتعديلات[هي]?(?![؀-ۿ]).*$/, " ")
    .replace(/\s*(?:رقم|لسنه|لعام|سنه|عام)(?![؀-ۿ]).*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool(poolConfig(process.env.DATABASE_URL));

  const { rows } = await pool.query<Row>(
    `SELECT id, title, source_type, law_number, year, amendment_of
       FROM legal_sources
      WHERE source_type IN ('law','regulation','instruction')
      ORDER BY id`
  );

  const bases = rows.filter((r) => !isAmendingTitle(r.title));
  const amendments = rows.filter((r) => isAmendingTitle(r.title));

  // Index base laws by folded name. A name with more than one base is
  // ambiguous — we record it and refuse to link rather than pick one.
  const baseByKey = new Map<string, Row[]>();
  for (const b of bases) {
    const k = baseKey(b.title);
    (baseByKey.get(k) ?? baseByKey.set(k, []).get(k)!).push(b);
  }

  type Plan = { row: Row; setNumber: string | null; setYear: number | null; linkTo: number | null; note: string };
  const plans: Plan[] = [];

  // 1) Every legislation row gets its number/year backfilled from its title.
  for (const r of rows) {
    const setNumber = r.law_number ?? parseLawNumber(r.title);
    const setYear = r.year ?? parseLawYear(r.title);
    if (!isAmendingTitle(r.title)) {
      if ((setNumber && setNumber !== r.law_number) || (setYear && setYear !== r.year)) {
        plans.push({ row: r, setNumber, setYear, linkTo: null, note: "base: backfill number/year" });
      }
      continue;
    }

    // 2) Amendments also get linked to their base by name.
    const wantName = baseLawName(r.title);
    let linkTo: number | null = r.amendment_of;
    let note = "";
    if (r.amendment_of !== null) {
      note = `already linked → ${r.amendment_of}`;
    } else if (!wantName) {
      note = "amendment: base name unparseable — left unlinked";
    } else {
      const cands = baseByKey.get(baseKey(wantName)) ?? [];
      if (cands.length === 1) {
        linkTo = cands[0].id;
        note = `link → ${cands[0].id} (${cands[0].title.slice(0, 40)})`;
      } else if (cands.length === 0) {
        note = `base "${wantName}" NOT in corpus — left unlinked (honest gap)`;
      } else {
        note = `base "${wantName}" ambiguous (${cands.map((c) => c.id).join(",")}) — left unlinked`;
      }
    }
    plans.push({ row: r, setNumber, setYear, linkTo, note });
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  legislation rows : ${rows.length}  (bases ${bases.length}, amendments ${amendments.length})`);
  console.log(`  planned changes  : ${plans.length}`);
  console.log(`${"=".repeat(64)}\n`);

  for (const p of plans) {
    const id = [p.setNumber ? `رقم ${p.setNumber}` : "—", p.setYear ?? "—"].join("/");
    console.log(`  [${String(p.row.id).padStart(3)}] ${p.row.title.slice(0, 46).padEnd(48)} ${id.padEnd(14)} ${p.note}`);
  }

  const links = plans.filter((p) => p.linkTo !== null && p.linkTo !== p.row.amendment_of).length;
  const gaps = plans.filter((p) => isAmendingTitle(p.row.title) && p.linkTo === null).length;
  console.log(`\n  new links: ${links}   unlinked amendments (base absent/ambiguous): ${gaps}`);

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.\n`);
    await pool.end();
    return;
  }

  let written = 0;
  for (const p of plans) {
    await pool.query(
      `UPDATE legal_sources
          SET law_number       = COALESCE($2, law_number),
              year             = COALESCE($3, year),
              amendment_of = COALESCE($4, amendment_of),
              updated_at       = now()
        WHERE id = $1`,
      [p.row.id, p.setNumber, p.setYear, p.linkTo]
    );
    written++;
  }

  console.log(`\nApplied ${written} update(s). Verify with the law_versions view:`);
  console.log(`  SELECT base_title, role, law_number, year, title FROM law_versions ORDER BY base_id, effective_date;\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("\nlink-amendments failed:", err.message);
  process.exit(1);
});
