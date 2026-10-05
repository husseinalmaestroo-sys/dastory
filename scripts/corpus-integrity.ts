/**
 * Corpus integrity actions (Phase 2.1; separate states since the 2026-10
 * corpus repair). Every change is logged in corpus_integrity_events with its
 * kind, who, why and against what; nothing is deleted.
 *
 * Bulk commands are DRY RUNS unless --apply is given. Every command prints
 * its target database (host, database, environment — never credentials);
 * every write is refused on an undeclared remote database, and on production
 * without --confirm-production (src/lib/db-target.ts, Phase 2.4).
 *
 *   npm run corpus:integrity -- prepare        [--apply]   apply-repairs, backfill-provenance, normalize-titles,
 *                                                          then check — in that order (what a deploy runs)
 *   npm run corpus:integrity -- apply-repairs  [--apply] [--only <id,id>]
 *                                                          the known-defect manifest, deploy/sources/corpus-repairs.json
 *   npm run corpus:integrity -- check          [--apply] [--recheck] [--source <id>]
 *                                                          integrity check of 'unchecked' sources (--recheck: 'passed' too)
 *   npm run corpus:integrity -- normalize-titles [--apply] title display form; law number / year from the title's own words
 *   npm run corpus:integrity -- backfill-provenance [--apply]
 *   npm run corpus:integrity -- auto-quarantine --actor <who> [--apply]
 *
 * Single-source decisions (applied at once; --actor and --reason required):
 *
 *   npm run corpus:integrity -- quarantine <id>          --actor <who> --reason "<why>" [--evidence ...]
 *   npm run corpus:integrity -- pass <id>                --actor <who> --reason "<why>" [--evidence ...]
 *   npm run corpus:integrity -- gazette-verify <id>      --actor <who> --reason "<why>" --evidence "<Gazette issue/page, URL or sha256>"
 *   npm run corpus:integrity -- gazette-unverify <id>    --actor <who> --reason "<why>"
 *   npm run corpus:integrity -- replace <oldId> <newId>  --actor <who> --reason "<why>" [--evidence ...]
 *   npm run corpus:integrity -- history <id>
 *
 * The states are separate (src/lib/corpus/integrity.ts): `pass` says the TEXT
 * is sound (integrity); `gazette-verify` says it was compared with the Official
 * Gazette — refused without the reference, and for a text that has not passed.
 * Neither changes provenance. The Phase 2.1 `verify`/`unverify` commands mixed
 * the two and are gone.
 *
 * Repairing a damaged source: ingest the text again from an authoritative
 * publication (npm run ingest …, which creates a NEW source and checks it),
 * then `replace <old> <new>`: the new source takes the old one's place in the
 * version chain and the old one is kept, never served.
 */
import "dotenv/config";
import { resolve } from "node:path";
import { getPool, query } from "../src/lib/db";
import { runIntegrityCheck } from "../src/lib/corpus/check";
import { replaceSource, setGazetteStatus, setIntegrity } from "../src/lib/corpus/integrity";
import { autoQuarantine, backfillProvenance, normalizeTitles } from "../src/lib/corpus/maintenance";
import { applyRepairs, type RepairPlanRow } from "../src/lib/corpus/repairs";
import { assertMayMutate, describeTarget, targetLine } from "../src/lib/db-target";

const BOOLEAN_FLAGS = new Set(["--apply", "--dry-run", "--recheck", "--confirm-production"]);
const SINGLE_SOURCE_WRITES = new Set(["quarantine", "pass", "gazette-verify", "gazette-unverify", "replace"]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The non-flag arguments (a "--name value" pair is a flag; the boolean flags take no value). */
export function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!BOOLEAN_FLAGS.has(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function need(v: string | undefined, what: string): string {
  if (!v?.trim()) {
    console.error(`Missing ${what}.`);
    process.exit(2);
  }
  return v;
}

const apply = process.argv.includes("--apply");
const mode = apply ? "" : " (dry run — nothing written; add --apply)";

function printRepairs(plan: RepairPlanRow[]): void {
  for (const p of plan) {
    const target = p.sourceId !== null ? `source ${p.sourceId}` : "—";
    const change = p.from !== null || p.to !== null ? ` ${p.from ?? "∅"} → ${p.to ?? "∅"}` : "";
    console.log(`  ${p.outcome.padEnd(9)} ${p.id.padEnd(34)} ${p.action.padEnd(14)} ${target}${change}  ${p.detail}`);
  }
  const by = (o: string) => plan.filter((p) => p.outcome === o).length;
  console.log(
    `Repairs: ${apply ? `${by("applied")} applied` : `${by("apply")} to apply`}, ${by("already")} already done, ${by("not_found")} not in this database, ` +
      `${by("mismatch")} mismatch, ${by("too_many")} too many matches, ${by("conflict")} conflict, ${by("review")} for review${mode}.`
  );
}

async function check(): Promise<void> {
  const source = arg("source");
  const plan = await runIntegrityCheck({
    apply,
    recheck: process.argv.includes("--recheck"),
    sourceIds: source ? [Number(source)] : undefined,
  });
  for (const p of plan) {
    const why = p.findings
      .filter((f) => (p.to === "quarantined" ? f.blocking : true))
      .map((f) => `${f.kind}: ${f.detail}`)
      .join(" | ");
    console.log(`  ${String(p.sourceId).padStart(6)}  ${p.from} → ${p.to}  ${p.title.slice(0, 60)}${why ? `  [${why}]` : ""}`);
  }
  const passed = plan.filter((p) => p.to === "passed").length;
  console.log(`Integrity check: ${passed} pass, ${plan.length - passed} quarantined${mode}.`);
}

async function main() {
  const [cmd, a, b] = positional(process.argv.slice(2));
  const target = describeTarget(process.env.DATABASE_URL ?? "");
  console.log(`Target: ${targetLine(target)}`);
  if ((apply && cmd !== "history") || SINGLE_SOURCE_WRITES.has(cmd)) {
    assertMayMutate(target, { confirmProduction: process.argv.includes("--confirm-production"), what: `corpus:integrity ${cmd}` });
  }
  const actor = arg("actor");
  const reason = arg("reason");
  const evidence = arg("evidence");
  switch (cmd) {
    case "prepare": {
      // Order matters: the manifest first (it quarantines the known-corrupt texts
      // and records provenance only where none is recorded), then the download-
      // list provenance, the titles, and last the check of whatever is still
      // unchecked — a quarantined text is never re-judged by it.
      console.log("1/4 Known-defect manifest (deploy/sources/corpus-repairs.json)");
      printRepairs(await applyRepairs({ apply }));
      console.log("2/4 Provenance from the download lists (deploy/sources/*.txt)");
      const matches = await backfillProvenance(resolve("deploy/sources"), apply);
      console.log(`  ${matches.length} source(s) matched to a listed URL${mode}.`);
      console.log("3/4 Titles, law numbers and years");
      const fixes = await normalizeTitles(apply);
      console.log(`  ${fixes.length} source(s)${mode}.`);
      console.log("4/4 Integrity check of every unchecked source");
      await check();
      break;
    }
    case "apply-repairs":
      printRepairs(await applyRepairs({ apply, only: arg("only")?.split(",").map((s) => s.trim()).filter(Boolean) }));
      break;
    case "check":
      await check();
      break;
    case "quarantine":
    case "pass": {
      const r = await setIntegrity(Number(need(a, "source id")), cmd === "pass" ? "passed" : "quarantined", {
        actor: need(actor, "--actor"),
        reason: need(reason, "--reason"),
        evidence,
      });
      console.log(`source ${a}: integrity ${r.from} → ${r.to}`);
      break;
    }
    case "gazette-verify":
    case "gazette-unverify": {
      const r = await setGazetteStatus(Number(need(a, "source id")), cmd === "gazette-verify" ? "verified" : "unverified", {
        actor: need(actor, "--actor"),
        reason: need(reason, "--reason"),
        evidence: cmd === "gazette-verify" ? need(evidence, "--evidence (the Official Gazette reference compared against)") : evidence,
      });
      console.log(`source ${a}: Gazette ${r.from} → ${r.to}`);
      break;
    }
    case "verify":
    case "unverify":
      console.error(
        `"${cmd}" mixed two separate facts and was removed. Use \`pass\` / \`quarantine\` for the text's integrity, ` +
          "`gazette-verify` / `gazette-unverify` for comparison with the Official Gazette."
      );
      process.exit(2);
      break;
    case "replace":
      await replaceSource(Number(need(a, "old source id")), Number(need(b, "new source id")), { actor: need(actor, "--actor"), reason: need(reason, "--reason"), evidence });
      console.log(`source ${a} replaced by ${b}`);
      break;
    case "normalize-titles": {
      const fixes = await normalizeTitles(apply);
      for (const f of fixes) {
        const extra = [f.lawNumber ? `law_number ${f.lawNumber}` : null, f.year ? `year ${f.year}` : null].filter(Boolean).join(", ");
        console.log(`  ${String(f.sourceId).padStart(6)}  ${f.from === f.to ? "(title unchanged)" : `"${f.from}" → "${f.to}"`}${extra ? `  [${extra}]` : ""}`);
      }
      console.log(`${fixes.length} source(s)${mode}.`);
      break;
    }
    case "auto-quarantine": {
      const t = await autoQuarantine(need(actor, "--actor"), apply);
      for (const x of t) console.log(`  ${apply ? "quarantined" : "would quarantine"} ${x.sourceId}: ${x.reason}`);
      console.log(`${t.length} source(s)${mode}.`);
      break;
    }
    case "backfill-provenance": {
      const matches = await backfillProvenance(resolve("deploy/sources"), apply);
      for (const m of matches) console.log(`  ${String(m.sourceId).padStart(5)}  ${m.provenance.padEnd(9)} ${m.url}`);
      console.log(`${matches.length} source(s) matched to a listed URL${mode}.`);
      break;
    }
    case "history": {
      const rows = await query(
        `SELECT created_at, kind, from_status, to_status, actor, reason, evidence FROM corpus_integrity_events WHERE source_id = $1 ORDER BY created_at, id`,
        [Number(need(a, "source id"))]
      );
      for (const r of rows) {
        console.log(`${new Date(String(r.created_at)).toISOString()}  [${r.kind}] ${r.from_status ?? "∅"} → ${r.to_status}  ${r.actor}: ${r.reason}${r.evidence ? ` [${r.evidence}]` : ""}`);
      }
      break;
    }
    default:
      console.error("Usage: see the header of scripts/corpus-integrity.ts");
      process.exit(2);
  }
}

if (require.main === module) {
  main()
    .then(() => getPool().end())
    .catch(async (err) => {
      console.error((err as Error).message);
      await getPool().end();
      process.exit(1);
    });
}
