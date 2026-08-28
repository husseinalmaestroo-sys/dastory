/**
 * One-off pull for manually auditing self-verify.ts's judge calibration
 * (2026-07-25). Prints the 8 flagged chat_history rows in full, plus a random
 * sample of the rows where the verifier ran and passed clean, so a human can
 * check the judge's issues/severity/action against the actual question,
 * answer, and cited sources. Not part of the permanent toolchain.
 */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool(poolConfig(process.env.DATABASE_URL));

  const { rows: breakdown } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE verification_severity IS NULL)::int AS verifier_not_run,
      COUNT(*) FILTER (WHERE verification_severity = 'none')::int AS clean_pass,
      COUNT(*) FILTER (WHERE verification_severity = 'low')::int AS low,
      COUNT(*) FILTER (WHERE verification_severity = 'medium')::int AS medium,
      COUNT(*) FILTER (WHERE verification_severity = 'high')::int AS high,
      COUNT(*) FILTER (WHERE verification_severity = 'critical')::int AS critical,
      COUNT(*) FILTER (WHERE verification_repaired = true)::int AS repaired,
      COUNT(*) FILTER (WHERE array_length(verification_issues,1) > 0)::int AS has_issues
    FROM chat_history
  `);
  console.log("\n=== breakdown ===");
  console.log(breakdown[0]);

  console.log("\n=== issue code frequency ===");
  const { rows: issueFreq } = await pool.query(`
    SELECT unnest(verification_issues) AS issue, COUNT(*)::int AS n
      FROM chat_history
     WHERE verification_issues IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC
  `);
  for (const r of issueFreq) console.log(`  ${String(r.n).padStart(3)}x  ${r.issue}`);

  console.log("\n\n=== ALL flagged rows (verification_issues non-empty) ===\n");
  const { rows: flagged } = await pool.query(`
    SELECT id, question, answer, sources_used, mode, grounded,
           verification_issues, verification_severity, verification_action, verification_repaired,
           created_at::date::text AS d
      FROM chat_history
     WHERE array_length(verification_issues,1) > 0
     ORDER BY created_at
  `);
  for (const r of flagged) {
    console.log(`--- id=${r.id} [${r.d}] mode=${r.mode} grounded=${r.grounded} ---`);
    console.log(`Q: ${r.question}`);
    console.log(`ISSUES: ${r.verification_issues}  SEVERITY: ${r.verification_severity}  ACTION: ${r.verification_action}  REPAIRED: ${r.verification_repaired}`);
    const sources = typeof r.sources_used === "string" ? JSON.parse(r.sources_used) : r.sources_used;
    console.log(`SOURCES (${sources.length}): ${sources.map((s: any) => `[${s.ref}] ${s.lawName ?? s.title}${s.articleNumber ? " م" + s.articleNumber : ""}`).join(" | ")}`);
    console.log(`ANSWER:\n${r.answer}\n`);
    console.log("SOURCE EXCERPTS:");
    for (const s of sources) console.log(`  [${s.ref}] ${s.lawName ?? s.title}${s.articleNumber ? " م" + s.articleNumber : ""}: ${(s.excerpt ?? "").slice(0, 300)}`);
    console.log("\n" + "=".repeat(100) + "\n");
  }

  console.log("\n\n=== RANDOM SAMPLE of clean-pass rows (severity='none', verifier actually ran) ===\n");
  const { rows: clean } = await pool.query(`
    SELECT id, question, answer, sources_used, mode, grounded,
           verification_severity, verification_action,
           created_at::date::text AS d
      FROM chat_history
     WHERE verification_severity = 'none'
     ORDER BY random()
     LIMIT 15
  `);
  for (const r of clean) {
    console.log(`--- id=${r.id} [${r.d}] mode=${r.mode} ---`);
    console.log(`Q: ${r.question}`);
    const sources = typeof r.sources_used === "string" ? JSON.parse(r.sources_used) : r.sources_used;
    console.log(`SOURCES (${sources.length}): ${sources.map((s: any) => `[${s.ref}] ${s.lawName ?? s.title}${s.articleNumber ? " م" + s.articleNumber : ""}`).join(" | ")}`);
    console.log(`ANSWER:\n${r.answer}\n`);
    console.log("SOURCE EXCERPTS:");
    for (const s of sources) console.log(`  [${s.ref}] ${s.lawName ?? s.title}${s.articleNumber ? " م" + s.articleNumber : ""}: ${(s.excerpt ?? "").slice(0, 300)}`);
    console.log("\n" + "-".repeat(100) + "\n");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
