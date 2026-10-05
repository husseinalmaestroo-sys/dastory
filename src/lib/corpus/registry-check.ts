import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldForSearch } from "../ingest/clean";
import { isAmendingTitle, parseLawNumber, parseLawYear } from "../ingest/law-identity";
import { normalizeTitle } from "../ingest/title";
import type { RequiredLaw } from "./inventory";

/**
 * The required-law registry (deploy/sources/required-laws.json) checked
 * against the repository's own records (corpus repair, 2026-10): every number
 * and year must be found, together, in the list the entry cites as its basis;
 * every law the benchmark expects an answer from must be registered. Nothing
 * here proves a number is the law's real number — only that the registry
 * copies its records faithfully. Each finding names what to fix; nothing is
 * changed automatically, and nothing is inferred from outside the repository.
 */

export type RegistryFindingKind =
  | "basis_mismatch" // the cited list does not carry this number/year for this law
  | "basis_unknown" // the entry cites a basis no list backs
  | "evidence_differs" // the entry's `evidence` is not what the check finds
  | "benchmark_law_unregistered" // the benchmark expects answers from a law the registry lacks
  | "duplicate"
  | "guidance_only"; // number/year rest on a list that calls itself guidance

export type RegistryFinding = { lawId: string | null; severity: "error" | "warning"; kind: RegistryFindingKind; detail: string };

export type RegistrySources = {
  /** File names of the URLs in deploy/sources/moj-laws-ar.txt, decoded. */
  mojLawFiles: string[];
  /** File names of the URLs in deploy/sources/moj-constitution-ar.txt, decoded. */
  constitutionFiles: string[];
  /** Numbered items ("1) قانون التجارة الأردني رقم 12 لسنة 1966") of deploy/sources/jordan-core-laws-missing.txt. */
  missingListItems: string[];
  /** expected_source values of benchmark/legal-qa-100.json. */
  benchmarkLaws: string[];
};

const fold = (s: string) => foldForSearch(normalizeTitle(s.replace(/[_-]+/g, " "))).replace(/\s+/g, " ").trim();

function fileNames(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//.test(l))
    .map((u) => {
      const last = u.split("/").pop() ?? "";
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    });
}

export function loadRegistrySources(sourcesDir: string, benchmarkPath: string): RegistrySources {
  const missing = readFileSync(join(sourcesDir, "jordan-core-laws-missing.txt"), "utf8");
  const bench = JSON.parse(readFileSync(benchmarkPath, "utf8")) as { cases?: { expected_source?: string | string[] }[] };
  return {
    mojLawFiles: fileNames(join(sourcesDir, "moj-laws-ar.txt")),
    constitutionFiles: fileNames(join(sourcesDir, "moj-constitution-ar.txt")),
    missingListItems: [...missing.matchAll(/^#\s*\d+\)\s*(.+?)\s*$/gm)].map((m) => m[1]),
    benchmarkLaws: [...new Set((bench.cases ?? []).flatMap((c) => (c.expected_source ? [c.expected_source].flat() : [])))],
  };
}

/** The record of `law` in a list of titles: an original (not amending) title naming the law. */
function recordFor(law: RequiredLaw, titles: string[]): string[] {
  const name = fold(law.name);
  return titles.filter((t) => {
    const f = fold(t.replace(/\.(pdf|txt|html?)$/i, ""));
    return !isAmendingTitle(normalizeTitle(t.replace(/[_-]+/g, " "))) && (f.startsWith(name) || f.includes(` ${name}`) || f.startsWith(name.replace(/^ال/, "")));
  });
}

export function crossCheckRegistry(laws: RequiredLaw[], src: RegistrySources): { findings: RegistryFinding[]; evidence: Record<string, string | null> } {
  const findings: RegistryFinding[] = [];
  const evidence: Record<string, string | null> = {};
  const seen = new Map<string, string>();

  for (const law of laws) {
    for (const key of [law.id, fold(law.name)]) {
      if (seen.has(key)) findings.push({ lawId: law.id, severity: "error", kind: "duplicate", detail: `duplicates ${seen.get(key)}` });
      seen.set(key, law.id);
    }

    const cite = (title: string) => {
      const t = normalizeTitle(title.replace(/[_-]+/g, " ").replace(/\.(pdf|txt|html?)$/i, ""));
      return { number: parseLawNumber(t), year: parseLawYear(t) };
    };
    const agrees = (title: string) => {
      const c = cite(title);
      return (law.number ?? null) === (c.number === null ? null : String(Number(c.number))) && (law.year ?? null) === c.year;
    };

    let found: string | null = null;
    switch (law.basis) {
      case "moj-list": {
        const records = recordFor(law, src.mojLawFiles);
        found = records.find(agrees) ?? null;
        if (!found) {
          findings.push({
            lawId: law.id,
            severity: "error",
            kind: "basis_mismatch",
            detail: records.length
              ? `moj-laws-ar.txt names it ${records.map((r) => `"${r}"`).join(", ")} — not number ${law.number ?? "∅"} / year ${law.year ?? "∅"}`
              : `moj-laws-ar.txt has no original-law file named "${law.name}"`,
          });
        }
        if (found) found = `deploy/sources/moj-laws-ar.txt: ${found}`;
        break;
      }
      case "moj-constitution-list": {
        if (law.number || law.year) findings.push({ lawId: law.id, severity: "error", kind: "basis_mismatch", detail: "the constitution list carries no number or year" });
        found = src.constitutionFiles.length > 0 ? `deploy/sources/moj-constitution-ar.txt: ${src.constitutionFiles.length} chapter files` : null;
        if (!found) findings.push({ lawId: law.id, severity: "error", kind: "basis_mismatch", detail: "moj-constitution-ar.txt lists no file" });
        break;
      }
      case "missing-list": {
        const records = recordFor(law, src.missingListItems);
        const item = records.find(agrees) ?? null;
        if (!item) {
          findings.push({
            lawId: law.id,
            severity: "error",
            kind: "basis_mismatch",
            detail: records.length
              ? `jordan-core-laws-missing.txt names it ${records.map((r) => `"${r}"`).join(", ")} — not number ${law.number ?? "∅"} / year ${law.year ?? "∅"}`
              : `jordan-core-laws-missing.txt has no item named "${law.name}"`,
          });
        } else {
          found = `deploy/sources/jordan-core-laws-missing.txt: ${item}`;
          findings.push({
            lawId: law.id,
            severity: "warning",
            kind: "guidance_only",
            detail: `number ${law.number} / year ${law.year} rest only on jordan-core-laws-missing.txt, which says they are for guidance and must be checked against the official text at ingest`,
          });
        }
        break;
      }
      default:
        findings.push({ lawId: law.id, severity: "error", kind: "basis_unknown", detail: `basis "${law.basis}" is not a list in deploy/sources` });
    }
    evidence[law.id] = found;
    if (law.evidence !== undefined && law.evidence !== found) {
      findings.push({ lawId: law.id, severity: "error", kind: "evidence_differs", detail: `registry says "${law.evidence}", the check finds "${found ?? "nothing"}"` });
    }
  }

  const names = laws.map((l) => fold(l.name));
  for (const b of src.benchmarkLaws) {
    if (!names.includes(fold(b))) {
      findings.push({ lawId: null, severity: "error", kind: "benchmark_law_unregistered", detail: `benchmark/legal-qa-100.json expects answers from "${b}", which the registry does not list` });
    }
  }
  return { findings, evidence };
}
