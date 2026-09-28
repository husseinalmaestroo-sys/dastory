import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileNameFrom } from "../ingest/source-files";

/**
 * Where a source's text came from, derived from the URL it was downloaded
 * from (Phase 2.1). bulk-ingest never recorded provenance, so every source
 * ingested before Phase 2 has provenance NULL ("not recorded"); the fetcher
 * named each stored file after its URL (ingest/source-files.ts), which lets
 * the backfill find the URL — and so the publisher — again.
 *
 * 'official' is reserved for the authority that issues or officially
 * publishes the text: the Legislation and Opinion Bureau and the Official
 * Gazette for legislation, the Judicial Council for its own decisions. A
 * government site that republishes a law it did not issue (the Ministry of
 * Justice's consolidated copies) is 'secondary' — conservative on purpose: a
 * secondary text is served, labelled, and never presented as authoritative.
 */
export type ProvenanceRule = { host: RegExp; provenance: "official" | "secondary"; authority: string };

export const PROVENANCE_RULES: ProvenanceRule[] = [
  { host: /(^|\.)lob\.gov\.jo$/i, provenance: "official", authority: "ديوان التشريع والرأي" },
  { host: /(^|\.)pm\.gov\.jo$/i, provenance: "official", authority: "رئاسة الوزراء — الجريدة الرسمية" },
  { host: /(^|\.)jc\.jo$/i, provenance: "official", authority: "المجلس القضائي الأردني" },
  { host: /(^|\.)moj\.gov\.jo$/i, provenance: "secondary", authority: "وزارة العدل (إعادة نشر)" },
  { host: /(^|\.)jba\.org\.jo$/i, provenance: "secondary", authority: "نقابة المحامين الأردنيين (إعادة نشر)" },
];

/** The rule for a URL's host, or null for a host no rule covers (provenance stays unrecorded). */
export function provenanceForUrl(url: string): ProvenanceRule | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return PROVENANCE_RULES.find((r) => r.host.test(host)) ?? null;
}

/** Every URL listed in the deploy/sources/*.txt download lists. */
export function listedSourceUrls(dir: string): string[] {
  const urls: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".txt"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      const t = line.trim();
      if (/^https?:\/\//.test(t)) urls.push(t);
    }
  }
  return urls;
}

export type ProvenanceMatch = { sourceId: number; url: string; provenance: "official" | "secondary"; authority: string };

/** The names the fetcher stores a URL under: a PDF by its file name, an HTML page as "<last segment>.txt". */
export function storedNamesFor(url: string): string[] {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    // The fetcher uses the raw (percent-encoded) segment for HTML pages.
    return [...new Set([fileNameFrom(url), ...(last ? [`${last}.txt`, `${decodeURIComponent(last)}.txt`] : [])])];
  } catch {
    return [];
  }
}

/**
 * Sources whose stored file is one the download lists name: the fetcher named
 * each file after its URL (storedNamesFor), so an exact name match identifies
 * the URL. A name listed under two different URLs is ambiguous and left
 * unrecorded.
 */
export function matchProvenance(sources: { id: number; file_path: string | null }[], urls: string[]): ProvenanceMatch[] {
  const byName = new Map<string, string[]>();
  for (const u of urls) {
    for (const name of storedNamesFor(u)) byName.set(name, [...(byName.get(name) ?? []), u]);
  }
  const out: ProvenanceMatch[] = [];
  for (const s of sources) {
    if (!s.file_path) continue;
    const candidates = [...new Set(byName.get(basename(s.file_path)) ?? [])];
    if (candidates.length !== 1) continue;
    const rule = provenanceForUrl(candidates[0]);
    if (!rule) continue;
    out.push({ sourceId: s.id, url: candidates[0], provenance: rule.provenance, authority: rule.authority });
  }
  return out;
}
