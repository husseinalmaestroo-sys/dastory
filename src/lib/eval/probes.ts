import "server-only";
import { foldForSearch, normalizeDigits } from "../ingest/clean";
import { classTier, sourceClassOf } from "../corpus/source-class";
import { PROVISO_RE } from "../search/hybrid";
import type { RetrievedChunk } from "../search/types";

/**
 * Scoring of the pre-registered real-corpus probes (Phase 2.4,
 * benchmark/live-probes-2.4.json; runner: scripts/live-probes.ts). Pure —
 * the runner reads the database, these decide.
 *
 * A probe's gold is structural (the file's _gold): the law it names, resolved
 * against the stored titles; the article it names, if the law's servable text
 * holds it; or the behaviour the system is designed for. The expected outcome
 * is fixed from the database BEFORE the probe runs (expectationFor).
 */

export type Probe = {
  id: string;
  category: string;
  question: string;
  /** Registry id (deploy/sources/required-laws.json). */
  law?: string;
  /** The article of `law` the question names. */
  article?: string;
  /** An article named with no law: expected outcome from how many servable texts hold it. */
  ambiguousArticle?: string;
  expectModes?: string[];
  expectModesIfAbsent?: string[];
  expectHeldBackOrServableClean?: boolean;
  titleIncludes?: string[];
  decisionSeeking?: boolean;
  mouAsked?: boolean;
  legislationFirst?: boolean;
  historical?: boolean;
  noFabricatedCitation?: boolean;
  articleIntegrity?: boolean;
};

/** Sources of a law (or of a title), split by whether they may be served. */
export type Gold = { all: number[]; servable: number[]; heldBack: number[]; articlePresent: boolean | null };

export type ProbeGold = {
  law: Gold | null;
  title: Gold | null;
  /** Servable sources holding `ambiguousArticle`. */
  articleHolders: number[] | null;
};

export type Expected =
  | { kind: "mode"; modes: string[]; why: string }
  | { kind: "article_first"; sources: number[]; article: string; why: string }
  | { kind: "retrieve"; sources: number[]; why: string }
  | { kind: "class_order"; why: string };

/** Outcomes of generation: a pre-generation "generation" satisfies an expectation only if it lists all of them. */
export const GENERATED_MODES = ["grounded", "partial", "sources_only"];

export const articleKey = (a: string | null | undefined): string => (a ? normalizeDigits(a).trim() : "");

/** Whether a title contains a word, folded as titles are. A bare number keeps its digits and matches whole (30 is not 1930). */
export function titleHas(title: string, term: string): boolean {
  const t = term.trim();
  if (/^\p{N}+$/u.test(t)) return new RegExp(`(^|\\D)${normalizeDigits(t)}(\\D|$)`).test(normalizeDigits(title));
  return foldForSearch(title).includes(foldForSearch(t));
}

export function expectationFor(p: Probe, gold: ProbeGold): Expected {
  if (p.expectModes) return { kind: "mode", modes: p.expectModes, why: "the designed behaviour (pre-registered)" };
  if (p.ambiguousArticle !== undefined) {
    const h = gold.articleHolders ?? [];
    const a = p.ambiguousArticle;
    if (h.length >= 2) return { kind: "mode", modes: ["clarification"], why: `article ${a} is in ${h.length} servable texts (${h.slice(0, 12).join(", ")}${h.length > 12 ? ", …" : ""})` };
    if (h.length === 1) return { kind: "article_first", sources: h, article: a, why: `article ${a} is in one servable text (${h[0]})` };
    return { kind: "mode", modes: ["no_evidence", "article_not_in_corpus"], why: `no servable text holds article ${a}` };
  }
  if (p.law && gold.law) {
    const g = gold.law;
    if (g.all.length === 0) return { kind: "mode", modes: p.expectModesIfAbsent ?? ["law_not_in_corpus"], why: "no source of the law is in this database" };
    if (g.servable.length === 0) return { kind: "mode", modes: ["law_unavailable"], why: `the law is in the database (${g.heldBack.join(", ")}) but no text of it is servable` };
    if (p.article) {
      return g.articlePresent
        ? { kind: "article_first", sources: g.servable, article: p.article, why: `article ${p.article} is in the servable text of the law` }
        : { kind: "mode", modes: ["article_not_in_corpus"], why: `article ${p.article} is not in the servable text of the law` };
    }
    return { kind: "retrieve", sources: g.servable, why: `the law is servable (${g.servable.join(", ")})` };
  }
  if (p.titleIncludes && gold.title) {
    const g = gold.title;
    const words = p.titleIncludes.join(" + ");
    if (g.servable.length > 0) return { kind: "retrieve", sources: g.servable, why: `servable source(s) titled with "${words}": ${g.servable.join(", ")}` };
    if (g.all.length > 0) return { kind: "mode", modes: ["law_unavailable", "decision_not_in_corpus", "no_evidence"], why: `source(s) titled with "${words}" (${g.all.join(", ")}) exist, none servable` };
    return { kind: "mode", modes: ["law_not_in_corpus", "decision_not_in_corpus", "no_evidence"], why: `no source is titled with "${words}"` };
  }
  if (p.legislationFirst) return { kind: "class_order", why: "legislation before lower classes (the hard check)" };
  throw new Error(`probe ${p.id}: no expectation can be derived — a structural error in the probe file (record it under _changes)`);
}

type Ranked = Pick<RetrievedChunk, "source_id" | "source_type" | "source_title" | "article_number" | "exact_hit" | "companion_of">;

/** Tier of a retrieved chunk under the class policy (corpus/source-class.ts), with the exemptions the PROBE declares — not the system's own detection. */
export function effectiveTier(c: Ranked, p: Pick<Probe, "decisionSeeking" | "mouAsked">): number {
  const cls = sourceClassOf(c.source_type, c.source_title);
  if (c.exact_hit) return 0;
  if (p.decisionSeeking && (cls === "court_decision" || cls === "interpretation")) return 0;
  if (p.mouAsked && cls === "mou") return 0;
  return classTier(cls);
}

/**
 * Every chunk ranked below one of a lower class (higher tier): "a memorandum
 * or a secondary text never outranks an admitted legislative text". A
 * companion article (carried by reference, appended after) is never the
 * outranked one.
 */
export function classOrderViolations(chunks: Ranked[], p: Pick<Probe, "decisionSeeking" | "mouAsked">): string[] {
  const out: string[] = [];
  const cls = (c: Ranked) => sourceClassOf(c.source_type, c.source_title);
  for (let j = 0; j < chunks.length; j++) {
    if (chunks[j].companion_of) continue;
    const tj = effectiveTier(chunks[j], p);
    const i = chunks.slice(0, j).findIndex((c) => effectiveTier(c, p) > tj);
    if (i >= 0) out.push(`#${i + 1} ${cls(chunks[i])} (source ${chunks[i].source_id}) above #${j + 1} ${cls(chunks[j])} (source ${chunks[j].source_id})`);
  }
  return out;
}

const squash = (t: string) =>
  normalizeDigits(t)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export type IntegrityVerdict = "whole" | "excerpt_with_provisos" | "excerpt_missing_provisos" | "part_only";

/**
 * Whether a retrieved article reached the model whole. `parts` are the stored
 * chunks of the same source and article number, in chunk order; the article
 * is the contiguous run around the retrieved one (search/hybrid.ts
 * mergeArticleParts). Whole: every part is in the retrieved text. An excerpt
 * of an over-long article ("…" first) must still carry every exception or
 * condition sentence (PROVISO_RE).
 */
export function integrityVerdict(
  retrieved: { id: number; chunk_text: string },
  parts: { id: number; chunk_index: number; chunk_text: string }[]
): IntegrityVerdict {
  const at = parts.findIndex((p) => Number(p.id) === Number(retrieved.id));
  if (at < 0) return "whole";
  let lo = at;
  let hi = at;
  while (lo > 0 && parts[lo - 1].chunk_index === parts[lo].chunk_index - 1) lo--;
  while (hi < parts.length - 1 && parts[hi + 1].chunk_index === parts[hi].chunk_index + 1) hi++;
  if (lo === hi) return "whole";
  const got = squash(retrieved.chunk_text);
  const run = parts.slice(lo, hi + 1);
  if (run.every((p) => got.includes(squash(p.chunk_text).slice(-60)))) return "whole";
  if (!retrieved.chunk_text.trimStart().startsWith("…")) return "part_only";
  const provisos = run
    .map((p) => p.chunk_text)
    .join(" ")
    .split(/(?<=[.؛!؟])\s+/)
    .filter((s) => PROVISO_RE.test(s));
  return provisos.every((s) => got.includes(squash(s).slice(0, 60))) ? "excerpt_with_provisos" : "excerpt_missing_provisos";
}

/** Article numbers a text asserts ("المادة 32", "الماده (7)"). */
export function articlesAsserted(text: string): string[] {
  return [...normalizeDigits(text).matchAll(/(?:ال)?ماد[ةه]\s*[({[]?\s*(\d{1,4})/g)].map((m) => m[1]);
}

/**
 * Whether the outcome meets the expectation. `mode` is the pipeline's mode —
 * the final one with answers, else the pre-generation decision, where
 * "generation" means handed to the model.
 */
export function judge(
  expected: Expected,
  o: { mode: string; top: Ranked[]; k: number; classViolations: string[] }
): { pass: boolean; why: string; firstGoldRank: number | null; articleRank: number | null; goldInTopK: number } {
  const gold = new Set(expected.kind === "retrieve" || expected.kind === "article_first" ? expected.sources : []);
  const firstGold = o.top.findIndex((c) => gold.has(Number(c.source_id)));
  const articleIdx = expected.kind === "article_first" ? o.top.findIndex((c) => gold.has(Number(c.source_id)) && articleKey(c.article_number) === expected.article) : -1;
  const base = {
    firstGoldRank: firstGold >= 0 ? firstGold + 1 : null,
    articleRank: articleIdx >= 0 ? articleIdx + 1 : null,
    goldInTopK: o.top.filter((c) => gold.has(Number(c.source_id))).length,
  };
  switch (expected.kind) {
    case "mode": {
      const pass = expected.modes.includes(o.mode) || (o.mode === "generation" && GENERATED_MODES.every((m) => expected.modes.includes(m)));
      return {
        ...base,
        pass,
        why: pass ? `mode ${o.mode}` : `mode ${o.mode}, expected ${expected.modes.join(" | ")}${o.mode === "generation" ? " (handed to the model; --answers gives its outcome)" : ""}`,
      };
    }
    case "article_first":
      return {
        ...base,
        pass: articleIdx === 0,
        why: articleIdx === 0 ? "the named article ranks first" : articleIdx > 0 ? `the named article ranks ${articleIdx + 1}` : `the named article is not in the top ${o.k} (mode ${o.mode})`,
      };
    case "retrieve":
      return { ...base, pass: firstGold >= 0, why: firstGold >= 0 ? `first source of it at rank ${firstGold + 1}` : `no source of it in the top ${o.k} (mode ${o.mode})` };
    case "class_order":
      return { ...base, pass: o.classViolations.length === 0, why: o.classViolations.length === 0 ? `class order holds over ${o.top.length} result(s)` : o.classViolations.join("; ") };
  }
}
