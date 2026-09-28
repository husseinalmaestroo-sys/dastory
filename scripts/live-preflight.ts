/**
 * Live-evaluation preflight (Phase 2.1): would a live run here measure real
 * models over the real corpus? Read-only; prints whether each key is set,
 * never a value.
 *
 *   npm run eval:preflight -- [--json out.json] [--registry deploy/sources/required-laws.json]
 *                             [--retrieval-only] [--probe]
 *
 * Exit 0 = PASS, 2 = BLOCKED. What blocks and why: src/lib/eval/live-preflight.ts.
 * --probe additionally makes one short embedding call and one tiny chat call
 * (a fraction of a cent) to prove the providers answer from this machine;
 * without it nothing leaves the machine except the database connection.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../src/lib/db";
import { preflightText, probeProviders, runLivePreflight } from "../src/lib/eval/live-preflight";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const needChat = !process.argv.includes("--retrieval-only");
  const result = await runLivePreflight({ registryPath: resolve(arg("registry") ?? "deploy/sources/required-laws.json"), needChat });
  if (result.ok && process.argv.includes("--probe")) {
    const vectorDim = Number(process.env.EMBEDDING_DIM ?? 1536);
    const probes = await probeProviders({ vectorDim, needChat });
    result.checks.push(...probes);
    result.ok = result.checks.every((c) => !c.blocking || c.ok);
  }
  console.log(preflightText(result));
  const json = arg("json");
  if (json) writeFileSync(json, JSON.stringify({ ranAt: new Date().toISOString(), ...result }, null, 1));
  try {
    await getPool().end();
  } catch {
    /* no database configured: nothing to close */
  }
  process.exit(result.ok ? 0 : 2);
}

main().catch((err) => {
  console.error("preflight failed to run:", err instanceof Error ? err.message : err);
  process.exit(2);
});
