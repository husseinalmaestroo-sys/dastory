import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assessArabicText } from "../ingest/quality";
import { foldForSearch } from "../ingest/clean";
import { isAmendingTitle, parseLawNumber, parseLawYear } from "../ingest/law-identity";
import { titleProblems } from "../ingest/title";
import { matchLawTitles, titleCitation } from "../search/law-reference";
import { authorityLevel, isAuthoritative, isServableSource, type AuthorityLevel } from "./integrity";
import { expectedSourceType, sourceClassOf, type SourceClass } from "./source-class";
import { isPartOfLaw } from "./check";

/**
 * Corpus inventory and anomaly detection (Phase 2.1; separate states since the
 * 2026-10 corpus repair).
 *
 * One pass over legal_sources + legal_documents answering, per source: what
 * law it is, what class of text, where it came from, whether its text passed
 * the integrity checks, whether it was compared with the Official Gazette,
 * whether it is the version in force, how many chunks it has and which model
 * embedded them — and what is wrong with it. Plus the coverage of the laws a
 * Jordanian legal assistant must be able to answer from
 * (deploy/sources/required-laws.json), with every state reported on its own:
 * none is inferred from another.
 *
 * analyzeInventory is pure (unit-tested); loadInventoryInput reads the DB.
 */

export type InventorySource = {
  id: number;
  title: string;
  source_type: string;
  status: string;
  jurisdiction: string;
  language: string;
  provenance: string | null;
  source_url: string | null;
  issuing_authority: string | null;
  integrity_status: string;
  /** 'verified' only with a recorded Gazette reference (db constraint). Absent in old inputs = unverified. */
  gazette_status?: string | null;
  is_current_version: boolean;
  supersedes: number | null;
  amendment_of: number | null;
  replaced_by?: number | null;
  law_number: string | null;
  /** legal_sources.year (decisions use it; laws usually carry the year in the title). */
  year?: number | null;
  effective_date: string | null;
  file_hash: string | null;
  chunk_count: number;
  is_synthetic: boolean;
};

export type InventoryChunks = {
  source_id: number;
  chunks: number;
  embedded: number;
  models: string[];
  /** Article numbers in chunk order (null = unnumbered chunk). */
  articles: (string | null)[];
  /** The start of the source's text, for the extraction-quality check. */
  sample_text: string;
};

export type RequiredLaw = {
  id: string;
  name: string;
  kind: string;
  number?: string;
  year?: number;
  priority: "P0" | "P1";
  category: string;
  /** Which repository list the number/year are copied from: moj-list, moj-constitution-list, missing-list (corpus/registry-check.ts). */
  basis: string;
  /** The exact record in that list (checked by corpus/registry-check.ts; a guidance list is not a citation source). */
  evidence?: string;
};

export type AnomalyKind =
  | "missing_law"
  | "law_not_servable"
  | "failed_ingest"
  | "empty_source"
  | "garbled_text"
  | "integrity_unchecked"
  | "missing_embeddings"
  | "mixed_embedding_models"
  | "stale_embedding_model"
  | "chunk_count_mismatch"
  | "unnumbered_articles"
  | "article_gaps"
  | "article_duplicates"
  | "article_order"
  | "provenance_unrecorded"
  | "invalid_metadata"
  | "metadata_incomplete"
  | "malformed_title"
  | "source_class_mismatch"
  | "amendment_unlinked"
  | "duplicate_file"
  | "duplicate_content"
  | "duplicate_law"
  | "multiple_current_versions"
  | "orphan_chunks";

export type Anomaly = {
  kind: AnomalyKind;
  severity: "critical" | "warning";
  sourceId?: number;
  law?: string;
  detail: string;
};

export type ArticleSequence = { numbered: number; unnumbered: number; distinct: number; gaps: number[]; missingRatio: number; duplicates: string[]; outOfOrder: number };

export type SourceReport = InventorySource & {
  kind: string | null;
  number: string | null;
  year: number | null;
  sourceClass: SourceClass;
  /** Retrieval may serve it (corpus/integrity.ts servableSourceSql, in JS). */
  servable: boolean;
  integrityPassed: boolean;
  gazetteVerified: boolean;
  authoritative: boolean;
  authorityLevel: AuthorityLevel;
  /** Statutes: number and year known (column or title). Decisions and others: not applicable (true). */
  metadataComplete: boolean;
  chunksActual: number;
  embedded: number;
  models: string[];
  articles: ArticleSequence;
  garbled: string | null;
  anomalies: Anomaly[];
};

/**
 * One required law and each of its states, separately (corpus repair). A
 * state is true only when a SERVABLE source of the law shows it — except
 * presentInDatabase, which counts any ready source, served or not.
 */
export type CoverageRow = {
  law: RequiredLaw;
  /** Every matched source, in any state. */
  sourceIds: number[];
  /** DATABASE VERIFIED presence: a ready source of the law is in the database this inventory read. */
  presentInDatabase: boolean;
  /** At least one of its texts may be served (integrity passed, ready, Jordanian, not a fixture). */
  servable: boolean;
  /** OFFICIAL SOURCE: a servable text recorded as from the official publisher. */
  officialSource: boolean;
  /** GAZETTE VERIFIED: a servable text compared with the Official Gazette (with a reference). */
  gazetteVerified: boolean;
  /** CURRENT VERSION: a servable text marked as the version in force. */
  currentVersion: boolean;
  /** EMBEDDED: every servable text fully embedded with the query model. */
  embedded: boolean;
  /** SEARCHABLE: servable and embedded. */
  searchable: boolean;
  /** AUTHORITATIVE: a servable text Gazette-verified, integrity passed, not a fixture. */
  authoritative: boolean;
  /** Number and year recorded for a servable text. */
  metadataComplete: boolean;
  /** How many matched sources are in each integrity state. */
  integrity: Record<string, number>;
  provenance: string[];
  articles: number;
  status: "absent" | "held_back" | "served_not_gazette_verified" | "authoritative";
};

export type InventoryReport = {
  generatedAt: string;
  servedModel: string | null;
  sources: SourceReport[];
  coverage: CoverageRow[];
  anomalies: Anomaly[];
  summary: {
    sources: number;
    servable: number;
    authoritative: number;
    gazetteVerified: number;
    officialProvenance: number;
    byIntegrity: Record<string, number>;
    byClass: Record<string, number>;
    chunks: number;
    critical: number;
    warnings: number;
    requiredLaws: number;
    requiredPresent: number;
    requiredServable: number;
    requiredAuthoritative: number;
  };
};

export function loadRegistry(path: string): RequiredLaw[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { laws: RequiredLaw[] };
  return raw.laws;
}

const LEADING_INT = /^\s*(\d{1,5})/;

/**
 * Numbering of a law's articles in chunk order: gaps, repeats and reversals
 * point at a broken extraction. One part of a law (corpus/check.ts
 * isPartOfLaw) is measured from its own lowest article, as the check does.
 */
export function articleSequence(articles: (string | null)[], opts: { fromLowest?: boolean } = {}): ArticleSequence {
  const numbered = articles.filter((a): a is string => !!a && LEADING_INT.test(a));
  const unnumbered = articles.length - numbered.length;
  // Consecutive chunks with one number are the parts of one long article.
  const runs: string[] = [];
  for (const a of numbered) if (runs[runs.length - 1] !== a) runs.push(a);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const r of runs) {
    if (seen.has(r)) duplicates.add(r);
    seen.add(r);
  }
  const ints = runs.map((r) => Number(r.match(LEADING_INT)![1]));
  let outOfOrder = 0;
  for (let i = 1; i < ints.length; i++) if (ints[i] < ints[i - 1]) outOfOrder++;
  const distinctInts = new Set(ints);
  const gaps: number[] = [];
  const low = opts.fromLowest && distinctInts.size ? Math.min(...distinctInts) : 1;
  if (distinctInts.size >= 3) {
    const max = Math.max(...distinctInts);
    for (let n = low; n <= max; n++) if (!distinctInts.has(n)) gaps.push(n);
  }
  const span = distinctInts.size ? Math.max(...distinctInts) - low + 1 : 0;
  return {
    numbered: numbered.length,
    unnumbered,
    distinct: distinctInts.size,
    gaps: gaps.slice(0, 50),
    missingRatio: span ? gaps.length / span : 0,
    duplicates: [...duplicates],
    outOfOrder,
  };
}

function lawIdentity(title: string): { kind: string | null; number: string | null; year: number | null; key: string | null } {
  const folded = foldForSearch(title);
  const c = titleCitation(folded);
  const amending = /^(?:قانون|نظام|تعليمات)\s+معد[ّ]?ل\s/.test(folded);
  const key = c.kind && c.number && c.year && !amending ? `${c.kind}|${c.number}|${c.year}` : null;
  return { kind: c.kind, number: c.number ?? null, year: c.year ?? null, key };
}

function isServable(s: InventorySource, chunks: number): boolean {
  return isServableSource(s, false) && chunks > 0;
}

/** A fingerprint of a text's content — catches byte-different but content-identical files. */
function contentFingerprint(sample: string): string | null {
  const t = foldForSearch(sample).replace(/\s+/g, " ").trim().slice(0, 4000);
  if (t.length < 400) return null;
  return createHash("sha256").update(t).digest("hex");
}

const STATUTE_TYPES = ["law", "regulation", "instruction"];

export function analyzeInventory(input: {
  sources: InventorySource[];
  chunks: InventoryChunks[];
  orphanChunks: number;
  registry: RequiredLaw[];
  /** The model the query vector is embedded with; vectors from any other model are invisible to retrieval. */
  servedModel: string | null;
  /** Evaluation fixtures count as servable here (the offline corpus). */
  includeSynthetic?: boolean;
}): InventoryReport {
  const byId = new Map(input.chunks.map((c) => [Number(c.source_id), c]));
  const anomalies: Anomaly[] = [];
  const add = (a: Anomaly, into?: Anomaly[]) => {
    anomalies.push(a);
    into?.push(a);
  };

  const reports: SourceReport[] = input.sources.map((s) => {
    const c = byId.get(Number(s.id));
    const own: Anomaly[] = [];
    const chunksActual = c?.chunks ?? 0;
    const id = lawIdentity(s.title);
    const servable = isServable({ ...s, is_synthetic: input.includeSynthetic ? false : s.is_synthetic }, chunksActual);
    const sid = Number(s.id);
    const statute = STATUTE_TYPES.includes(s.source_type);

    if (s.status !== "ready") add({ kind: "failed_ingest", severity: "warning", sourceId: sid, detail: `status ${s.status}` }, own);
    if (s.status === "ready" && chunksActual === 0) add({ kind: "empty_source", severity: "critical", sourceId: sid, detail: "ready with no chunks" }, own);
    if (s.status === "ready" && s.integrity_status === "unchecked") {
      add({ kind: "integrity_unchecked", severity: "warning", sourceId: sid, detail: "never checked — not served until it passes (npm run corpus:integrity -- check --apply)" }, own);
    }
    if (c && s.chunk_count !== chunksActual) {
      add({ kind: "chunk_count_mismatch", severity: "warning", sourceId: sid, detail: `recorded ${s.chunk_count}, stored ${chunksActual}` }, own);
    }
    if (c && c.embedded < c.chunks) {
      add({ kind: "missing_embeddings", severity: "critical", sourceId: sid, detail: `${c.chunks - c.embedded} of ${c.chunks} chunks have no vector` }, own);
    }
    if (c && c.models.length > 1) add({ kind: "mixed_embedding_models", severity: "critical", sourceId: sid, detail: c.models.join(", ") }, own);
    if (c && input.servedModel && c.models.length > 0 && c.models.some((m) => m !== input.servedModel)) {
      add({ kind: "stale_embedding_model", severity: "critical", sourceId: sid, detail: `${c.models.join(", ")} ≠ query model ${input.servedModel}` }, own);
    }

    const quality = c?.sample_text ? assessArabicText(c.sample_text) : null;
    const garbled = quality?.garbled ? quality.reason : null;
    if (garbled) add({ kind: "garbled_text", severity: "critical", sourceId: sid, detail: garbled }, own);

    const seq = articleSequence(c?.articles ?? [], { fromLowest: isPartOfLaw(s.title) });
    if (statute && c && !s.is_synthetic) {
      if (seq.numbered === 0 && chunksActual > 0) {
        add({ kind: "unnumbered_articles", severity: "warning", sourceId: sid, detail: "no chunk carries an article number" }, own);
      }
      if (seq.gaps.length > 0) {
        add(
          {
            kind: "article_gaps",
            severity: seq.missingRatio > 0.2 ? "critical" : "warning",
            sourceId: sid,
            detail: `${Math.round(seq.missingRatio * 100)}% of article numbers up to the highest are absent (first: ${seq.gaps.slice(0, 10).join(", ")})`,
          },
          own
        );
      }
      if (seq.duplicates.length > 0) {
        add({ kind: "article_duplicates", severity: "warning", sourceId: sid, detail: `repeated: ${seq.duplicates.slice(0, 10).join(", ")}` }, own);
      }
      if (seq.outOfOrder > 0) add({ kind: "article_order", severity: "warning", sourceId: sid, detail: `${seq.outOfOrder} reversal(s) in article order` }, own);
    }

    if (!s.provenance) add({ kind: "provenance_unrecorded", severity: "warning", sourceId: sid, detail: "where the text came from is not recorded" }, own);
    const meta: string[] = [];
    if (!/^[A-Z]{2}$/.test(s.jurisdiction ?? "")) meta.push(`jurisdiction "${s.jurisdiction}"`);
    if (s.is_synthetic && s.provenance !== "synthetic") meta.push("synthetic fixture not marked provenance=synthetic");
    if (!s.is_synthetic && s.provenance === "synthetic") meta.push("provenance=synthetic on a non-fixture source");
    if (statute && !s.effective_date) meta.push("no effective date");
    if (s.provenance === "official" && !s.source_url) meta.push("official provenance without a source URL");
    if (meta.length) {
      add({ kind: "invalid_metadata", severity: meta.some((m) => m.startsWith("synthetic") || m.startsWith("provenance=synthetic")) ? "critical" : "warning", sourceId: sid, detail: meta.join("; ") }, own);
    }

    // Number and year of a statute: recorded or in the title, never guessed.
    const number = s.law_number ?? parseLawNumber(s.title) ?? id.number;
    const year = (statute ? (s.year ?? null) : null) ?? parseLawYear(s.title) ?? id.year ?? null;
    const amending = isAmendingTitle(s.title);
    const constitution = /^(?:ال)?دستور/.test(foldForSearch(s.title).trim());
    const metadataComplete = !statute || constitution || (!!number && !!year);
    if (statute && !constitution && !metadataComplete) {
      add({ kind: "metadata_incomplete", severity: "warning", sourceId: sid, detail: `law number ${number ?? "unknown"}, year ${year ?? "unknown"} — to be taken from the official text, never guessed` }, own);
    }
    for (const p of titleProblems(s.title)) {
      add(
        {
          kind: "malformed_title",
          severity: "warning",
          sourceId: sid,
          detail: p === "unnormalized" ? "title carries tatweel, underscores, unnormalised digits or a bracketed number (npm run corpus:integrity -- normalize-titles)" : `"لسنة" is not followed by a year: "${s.title}"`,
        },
        own
      );
    }
    const expected = expectedSourceType(s.source_type, s.title);
    if (expected) add({ kind: "source_class_mismatch", severity: "warning", sourceId: sid, detail: `filed as ${s.source_type}, title says ${expected}` }, own);
    if (statute && amending && s.amendment_of === null) {
      add({ kind: "amendment_unlinked", severity: "warning", sourceId: sid, detail: "an amending act not linked to the law it amends (amendment_of)" }, own);
    }

    const gazetteVerified = s.gazette_status === "verified";
    return {
      ...s,
      id: sid,
      kind: id.kind,
      number: number ?? null,
      year,
      sourceClass: sourceClassOf(s.source_type, s.title),
      servable,
      integrityPassed: s.integrity_status === "passed",
      gazetteVerified,
      authoritative: servable && isAuthoritative(s),
      authorityLevel: authorityLevel(s),
      metadataComplete,
      chunksActual,
      embedded: c?.embedded ?? 0,
      models: c?.models ?? [],
      articles: seq,
      garbled,
      anomalies: own,
    };
  });

  // ---- across sources
  const byHash = new Map<string, SourceReport[]>();
  for (const r of reports) if (r.file_hash && r.status === "ready") byHash.set(r.file_hash, [...(byHash.get(r.file_hash) ?? []), r]);
  for (const [hash, list] of byHash) {
    if (list.length > 1) add({ kind: "duplicate_file", severity: "warning", detail: `sources ${list.map((r) => r.id).join(", ")} share file hash ${hash.slice(0, 12)}` });
  }
  // The same text in two byte-different files (e.g. two PDFs of one regulation).
  const byContent = new Map<string, SourceReport[]>();
  for (const r of reports) {
    const fp = r.status === "ready" ? contentFingerprint(byId.get(r.id)?.sample_text ?? "") : null;
    if (fp) byContent.set(fp, [...(byContent.get(fp) ?? []), r]);
  }
  for (const list of byContent.values()) {
    const hashes = new Set(list.map((r) => r.file_hash ?? `none-${r.id}`));
    if (list.length > 1 && hashes.size > 1) {
      add({ kind: "duplicate_content", severity: "warning", detail: `sources ${list.map((r) => r.id).join(", ")} hold the same text in different files` });
    }
  }
  const byLaw = new Map<string, SourceReport[]>();
  for (const r of reports) {
    const key = lawIdentity(r.title).key;
    if (key && r.servable) byLaw.set(key, [...(byLaw.get(key) ?? []), r]);
  }
  for (const [key, list] of byLaw) {
    if (list.length < 2) continue;
    const current = list.filter((r) => r.is_current_version);
    if (current.length > 1) {
      add({
        kind: "multiple_current_versions",
        severity: "critical",
        law: key,
        detail: `sources ${current.map((r) => r.id).join(", ")} are all marked the version in force — retrieval can serve conflicting texts`,
      });
    }
    const linked = (a: SourceReport, b: SourceReport) => a.supersedes === b.id || b.supersedes === a.id || a.replaced_by === b.id || b.replaced_by === a.id;
    const unlinked = list.filter((a) => !list.some((b) => b !== a && linked(a, b)));
    if (unlinked.length > 1) {
      add({ kind: "duplicate_law", severity: "warning", law: key, detail: `sources ${unlinked.map((r) => r.id).join(", ")} hold the same law with no version link between them` });
    }
  }
  if (input.orphanChunks > 0) add({ kind: "orphan_chunks", severity: "critical", detail: `${input.orphanChunks} chunk(s) belong to no ready source` });

  // ---- coverage of the required laws: every state separately
  const titles = reports.map((r) => ({ id: r.id, folded: foldForSearch(r.title) }));
  const coverage: CoverageRow[] = input.registry.map((law) => {
    const ids = matchRequiredLaw(law, titles);
    const matched = reports.filter((r) => ids.includes(r.id));
    const served = matched.filter((r) => r.servable);
    const embedded = served.length > 0 && served.every((r) => r.embedded === r.chunksActual && (!input.servedModel || r.models.every((m) => m === input.servedModel)));
    const integrity: Record<string, number> = {};
    for (const r of matched) integrity[r.integrity_status] = (integrity[r.integrity_status] ?? 0) + 1;
    const presentInDatabase = matched.some((r) => r.status === "ready");
    const row: CoverageRow = {
      law,
      sourceIds: ids,
      presentInDatabase,
      servable: served.length > 0,
      officialSource: served.some((r) => r.provenance === "official"),
      gazetteVerified: served.some((r) => r.gazetteVerified),
      currentVersion: served.some((r) => r.is_current_version),
      embedded,
      searchable: served.length > 0 && embedded,
      authoritative: served.some((r) => r.authoritative),
      metadataComplete: served.some((r) => r.metadataComplete),
      integrity,
      provenance: [...new Set(matched.map((r) => r.provenance ?? "غير مسجّل"))],
      articles: new Set(served.flatMap((r) => (byId.get(r.id)?.articles ?? []).filter(Boolean))).size,
      status: served.some((r) => r.authoritative) ? "authoritative" : served.length > 0 ? "served_not_gazette_verified" : presentInDatabase ? "held_back" : "absent",
    };
    if (!presentInDatabase) {
      add({ kind: "missing_law", severity: law.priority === "P0" ? "critical" : "warning", law: law.name, detail: `${law.name}${law.number ? ` رقم ${law.number} لسنة ${law.year}` : ""} is not in the corpus` });
    } else if (!row.servable) {
      add({
        kind: "law_not_servable",
        severity: law.priority === "P0" ? "critical" : "warning",
        law: law.name,
        detail: `present, but no text of it can be served (${Object.entries(integrity).map(([k, n]) => `${n} ${k}`).join(", ")})`,
      });
    }
    return row;
  });

  const summaryCount = (sev: Anomaly["severity"]) => anomalies.filter((a) => a.severity === sev).length;
  const count = (f: (r: SourceReport) => string) => {
    const out: Record<string, number> = {};
    for (const r of reports) out[f(r)] = (out[f(r)] ?? 0) + 1;
    return out;
  };
  return {
    generatedAt: new Date().toISOString(),
    servedModel: input.servedModel,
    sources: reports,
    coverage,
    anomalies,
    summary: {
      sources: reports.length,
      servable: reports.filter((r) => r.servable).length,
      authoritative: reports.filter((r) => r.authoritative).length,
      gazetteVerified: reports.filter((r) => r.gazetteVerified).length,
      officialProvenance: reports.filter((r) => r.provenance === "official").length,
      byIntegrity: count((r) => r.integrity_status),
      byClass: count((r) => r.sourceClass),
      chunks: reports.reduce((n, r) => n + r.chunksActual, 0),
      critical: summaryCount("critical"),
      warnings: summaryCount("warning"),
      requiredLaws: coverage.length,
      requiredPresent: coverage.filter((c) => c.presentInDatabase).length,
      requiredServable: coverage.filter((c) => c.servable).length,
      requiredAuthoritative: coverage.filter((c) => c.status === "authoritative").length,
    },
  };
}

/** Sources that are a required law: same kind, number and year in the title; else the name as a title prefix (amending acts included). */
export function matchRequiredLaw(law: RequiredLaw, titles: { id: number; folded: string }[]): number[] {
  if (law.kind === "الدستور") return titles.filter((t) => /^(?:ال)?دستور/.test(t.folded.trim())).map((t) => t.id);
  if (law.number && law.year) {
    const exact = titles.filter((t) => {
      const c = titleCitation(t.folded);
      return c.kind === law.kind && c.number === String(Number(law.number)) && c.year === law.year;
    });
    // Amending acts of the law carry their own numbers; they belong to it by name.
    const amending = matchLawTitles({ key: foldForSearch(law.name), display: law.name }, titles).filter((id) =>
      /^(?:قانون|نظام|تعليمات)\s+معد[ّ]?ل\s/.test(titles.find((t) => t.id === id)!.folded)
    );
    // A source of the law whose title carries no number/year (a consolidated
    // text, or a title damaged at extraction) still belongs to it by name —
    // otherwise "قانون الملكية العقارية" would be reported absent.
    const byNameUnnumbered = matchLawTitles({ key: foldForSearch(law.name), display: law.name }, titles).filter((id) => {
      const c = titleCitation(titles.find((t) => t.id === id)!.folded);
      return c.number === undefined && c.year === undefined;
    });
    return [...new Set([...exact.map((t) => t.id), ...amending, ...byNameUnnumbered])];
  }
  return matchLawTitles({ key: foldForSearch(law.name), display: law.name }, titles);
}

// ---------------------------------------------------------------- database

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Reads what analyzeInventory needs. Text samples are the first ~12k characters of each source. */
export async function loadInventoryInput(db: Q): Promise<{ sources: InventorySource[]; chunks: InventoryChunks[]; orphanChunks: number }> {
  const sources = (
    await db.query(
      `SELECT id, title, source_type, status, jurisdiction, language, provenance, source_url, issuing_authority,
              integrity_status, gazette_status, is_current_version, supersedes, amendment_of, replaced_by, law_number, year,
              effective_date::text AS effective_date, file_hash, chunk_count, is_synthetic
         FROM legal_sources ORDER BY id`
    )
  ).rows.map((r) => ({
    ...(r as unknown as InventorySource),
    id: Number(r.id),
    supersedes: r.supersedes === null ? null : Number(r.supersedes),
    amendment_of: r.amendment_of === null ? null : Number(r.amendment_of),
    replaced_by: r.replaced_by === null ? null : Number(r.replaced_by),
    year: r.year === null || r.year === undefined ? null : Number(r.year),
    chunk_count: Number(r.chunk_count),
  }));
  const chunks = (
    await db.query(
      `SELECT source_id,
              count(*)::int AS chunks,
              count(embedding)::int AS embedded,
              COALESCE(array_agg(DISTINCT embedding_model) FILTER (WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL), '{}') AS models,
              array_agg(article_number ORDER BY chunk_index) AS articles,
              left(string_agg(chunk_text, E'\\n' ORDER BY chunk_index), 12000) AS sample_text
         FROM legal_documents GROUP BY source_id`
    )
  ).rows.map((r) => ({
    source_id: Number(r.source_id),
    chunks: Number(r.chunks),
    embedded: Number(r.embedded),
    models: (r.models as string[]) ?? [],
    articles: (r.articles as (string | null)[]) ?? [],
    sample_text: String(r.sample_text ?? ""),
  }));
  const orphan = await db.query(
    `SELECT count(*)::int AS n FROM legal_documents d LEFT JOIN legal_sources s ON s.id = d.source_id WHERE s.id IS NULL OR s.status <> 'ready'`
  );
  return { sources, chunks, orphanChunks: Number(orphan.rows[0]?.n ?? 0) };
}
