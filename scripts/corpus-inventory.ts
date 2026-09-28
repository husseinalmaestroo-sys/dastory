/**
 * Corpus inventory (Phase 2.1): every source, what law it is, where it came
 * from, whether it is current, verified, embedded and searchable — the
 * anomalies found — and the coverage of the laws Dastoori must answer from.
 *
 *   npm run corpus:inventory -- [--json out.json] [--md out.md] [--strict]
 *                               [--registry deploy/sources/required-laws.json]
 *
 * --strict exits 1 when a critical anomaly is found (for a deploy gate).
 * Read-only: it changes nothing. To act on what it finds, see
 * scripts/corpus-integrity.ts.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../src/lib/db";
import { analyzeInventory, loadInventoryInput, loadRegistry, type InventoryReport } from "../src/lib/corpus/inventory";
import { getEmbeddingProvider } from "../src/lib/ai";
import { env } from "../src/lib/env";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const yes = (b: boolean) => (b ? "✓" : "✗");

export function inventoryMarkdown(r: InventoryReport): string {
  const lines: string[] = [];
  lines.push(`# Corpus inventory — ${r.generatedAt}`, "");
  lines.push(
    `Sources ${r.summary.sources} · servable ${r.summary.servable} · authoritative ${r.summary.authoritative} · chunks ${r.summary.chunks} · ` +
      `critical anomalies ${r.summary.critical} · warnings ${r.summary.warnings} · query embedding model ${r.servedModel ?? "?"}`,
    ""
  );
  lines.push("## Coverage of required laws", "");
  lines.push("| Law | Priority | Required | Present | Official | Current | Provenance | Verified | Embedded | Searchable | Articles | Status |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of r.coverage) {
    const name = `${c.law.name}${c.law.number ? ` ${c.law.number}/${c.law.year}` : ""}`;
    lines.push(
      `| ${name} | ${c.law.priority} | ✓ | ${yes(c.present)} | ${yes(c.official)} | ${yes(c.current)} | ${c.provenance.join(", ") || "—"} | ${yes(c.verified)} | ${yes(c.embedded)} | ${yes(c.searchable)} | ${c.articles} | ${c.status} |`
    );
  }
  lines.push("", "## Anomalies", "");
  for (const sev of ["critical", "warning"] as const) {
    const list = r.anomalies.filter((a) => a.severity === sev);
    lines.push(`### ${sev} (${list.length})`, "");
    for (const a of list) lines.push(`- \`${a.kind}\`${a.sourceId ? ` source ${a.sourceId}` : ""}${a.law ? ` ${a.law}` : ""}: ${a.detail}`);
    lines.push("");
  }
  lines.push("## Sources", "");
  lines.push("| id | Title | Type | Law | Status | Integrity | Provenance | Current | Chunks | Embedded | Models | Servable | Authoritative |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of r.sources) {
    lines.push(
      `| ${s.id} | ${s.title.slice(0, 60)} | ${s.source_type} | ${s.number ? `${s.number}/${s.year ?? "?"}` : "—"} | ${s.status} | ${s.integrity_status} | ${s.provenance ?? "—"} | ${yes(s.is_current_version)} | ${s.chunksActual} | ${s.embedded} | ${s.models.join(", ") || "—"} | ${yes(s.servable)} | ${yes(s.authoritative)} |`
    );
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const registryPath = resolve(arg("registry") ?? "deploy/sources/required-laws.json");
  const pool = getPool();
  let servedModel: string | null = null;
  try {
    servedModel = getEmbeddingProvider().model;
  } catch {
    servedModel = null; // no embedding provider configured: model checks are skipped
  }
  const input = await loadInventoryInput(pool);
  const report = analyzeInventory({ ...input, registry: loadRegistry(registryPath), servedModel, includeSynthetic: env.allowSyntheticCorpus });
  await pool.end();

  const md = inventoryMarkdown(report);
  const json = arg("json");
  const mdOut = arg("md");
  if (json) writeFileSync(json, JSON.stringify(report, null, 1));
  if (mdOut) writeFileSync(mdOut, md);
  if (!json && !mdOut) process.stdout.write(md);
  else console.log(`Inventory: ${report.summary.sources} sources, ${report.summary.critical} critical / ${report.summary.warnings} warning anomalies.`);
  if (process.argv.includes("--strict") && report.summary.critical > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Inventory failed:", err);
    process.exit(1);
  });
}
