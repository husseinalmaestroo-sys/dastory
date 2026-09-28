/**
 * The live evaluation in one command (Phase 2.1):
 *
 *   npm run eval:live                # preflight → live eval suite → real-corpus retrieval benchmark
 *   npm run eval:live -- --generate  # … and the benchmark's paid citation/hallucination part
 *
 * 1. Preflight (src/lib/eval/live-preflight.ts). BLOCKED → exit 2, nothing
 *    else runs: a synthetic or test database, test providers or a missing key
 *    never produce a "live" result.
 * 2. scripts/eval.ts --mode live → eval/results/live-<date>.json (no-evidence,
 *    jurisdiction, injection, forged history, documents, tenant canaries,
 *    unauthorized access, adversarial outputs — on the real models).
 * 3. scripts/benchmark.ts → benchmark/last-run.json (retrieval on the real
 *    corpus over benchmark/legal-qa-100.json; labels GOLD UNVERIFIED until a
 *    qualified Jordanian reviewer checks them).
 *
 * Each step also runs the preflight itself, so calling one directly is just as
 * safe. Exit code: 2 blocked, 1 a step failed or a binding gate failed, 0 ok.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../src/lib/db";
import { preflightText, runLivePreflight } from "../src/lib/eval/live-preflight";

const ROOT = resolve(__dirname, "..");
const TSX = resolve(ROOT, "node_modules/tsx/dist/cli.mjs");

function step(name: string, script: string, args: string[]): number {
  console.log(`\n==== ${name}`);
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", "scripts/tsconfig.verify.json", script, ...args], { cwd: ROOT, stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

async function main() {
  const generate = process.argv.includes("--generate");
  const pre = await runLivePreflight({ registryPath: resolve(ROOT, "deploy/sources/required-laws.json") });
  try {
    await getPool().end();
  } catch {
    /* no database configured */
  }
  console.log(preflightText(pre));
  const dir = process.env.EVAL_RESULTS_DIR ?? resolve(ROOT, "eval/results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `live-preflight-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ ranAt: new Date().toISOString(), ...pre }, null, 1));
  if (!pre.ok) process.exit(2);

  const evalStatus = step("live evaluation suite", "scripts/eval.ts", ["--mode", "live"]);
  const benchStatus = step("real-corpus retrieval benchmark", "scripts/benchmark.ts", generate ? ["--generate"] : []);
  console.log(`\nlive evaluation: suite exit ${evalStatus}, benchmark exit ${benchStatus}`);
  process.exit(evalStatus === 2 || benchStatus === 2 ? 2 : Math.max(evalStatus, benchStatus));
}

main().catch((err) => {
  console.error("live evaluation failed to run:", err instanceof Error ? err.message : err);
  process.exit(2);
});
