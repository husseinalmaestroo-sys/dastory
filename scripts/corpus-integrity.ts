/**
 * Corpus integrity actions (Phase 2.1). Every change is logged in
 * corpus_integrity_events with who, why and against what; nothing is deleted.
 *
 *   npm run corpus:integrity -- quarantine <sourceId> --actor <who> --reason "<why>"
 *   npm run corpus:integrity -- verify     <sourceId> --actor <who> --reason "<why>" --evidence <official URL or sha256>
 *   npm run corpus:integrity -- unverify   <sourceId> --actor <who> --reason "<why>"
 *   npm run corpus:integrity -- replace    <oldId> <newId> --actor <who> --reason "<why>" [--evidence ...]
 *   npm run corpus:integrity -- auto-quarantine --actor <who> [--dry-run]
 *   npm run corpus:integrity -- backfill-provenance [--dry-run]
 *   npm run corpus:integrity -- history <sourceId>
 *
 * Repairing a damaged source: ingest the text again from the authoritative
 * publication (npm run ingest …, which creates a NEW source), check it with
 * npm run corpus:inventory, then `replace <old> <new>`: the new source takes
 * the old one's place in the version chain and the old one is kept, never
 * served. `verify` only after a reviewer compared the text with the official
 * publication.
 */
import "dotenv/config";
import { resolve } from "node:path";
import { getPool, query } from "../src/lib/db";
import { setIntegrity, replaceSource } from "../src/lib/corpus/integrity";
import { autoQuarantine, backfillProvenance } from "../src/lib/corpus/maintenance";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes("--dry-run");
const BOOLEAN_FLAGS = new Set(["--dry-run"]);

/** The non-flag arguments (a "--name value" pair is a flag; "--dry-run" takes no value). */
function positional(args: string[]): string[] {
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

async function main() {
  const [cmd, a, b] = positional(process.argv.slice(2));
  const actor = arg("actor");
  const reason = arg("reason");
  const evidence = arg("evidence");
  switch (cmd) {
    case "quarantine":
    case "verify":
    case "unverify": {
      const to = cmd === "quarantine" ? "quarantined" : cmd === "verify" ? "verified" : "unverified";
      const r = await setIntegrity(Number(need(a, "source id")), to, { actor: need(actor, "--actor"), reason: need(reason, "--reason"), evidence });
      console.log(`source ${a}: ${r.from} → ${r.to}`);
      break;
    }
    case "replace":
      await replaceSource(Number(need(a, "old source id")), Number(need(b, "new source id")), { actor: need(actor, "--actor"), reason: need(reason, "--reason"), evidence });
      console.log(`source ${a} replaced by ${b}`);
      break;
    case "auto-quarantine": {
      const t = await autoQuarantine(need(actor, "--actor"), !dryRun);
      for (const x of t) console.log(`  ${dryRun ? "would quarantine" : "quarantined"} ${x.sourceId}: ${x.reason}`);
      console.log(`${t.length} source(s)${dryRun ? " (dry run)" : ""}.`);
      break;
    }
    case "backfill-provenance": {
      const matches = await backfillProvenance(resolve("deploy/sources"), !dryRun);
      for (const m of matches) console.log(`  ${String(m.sourceId).padStart(5)}  ${m.provenance.padEnd(9)} ${m.url}`);
      console.log(`${matches.length} source(s) matched to a listed URL${dryRun ? " (dry run)" : ""}.`);
      break;
    }
    case "history": {
      const rows = await query(`SELECT created_at, from_status, to_status, actor, reason, evidence FROM corpus_integrity_events WHERE source_id = $1 ORDER BY created_at`, [
        Number(need(a, "source id")),
      ]);
      for (const r of rows) console.log(`${new Date(String(r.created_at)).toISOString()}  ${r.from_status} → ${r.to_status}  ${r.actor}: ${r.reason}${r.evidence ? ` [${r.evidence}]` : ""}`);
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
