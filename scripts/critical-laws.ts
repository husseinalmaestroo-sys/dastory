/**
 * Phase 2.4 — the critical-law checks (Phase D) and the source-class audit
 * (Phase E), answered from the database this points at, with evidence.
 * Read-only: it changes nothing.
 *
 *   npm run corpus:critical -- [--md out.md] [--json out.json]
 *
 * For each finding it states what the DATABASE shows, never what the
 * repository's history suggests. Retrieval checks call the configured
 * embedding provider for the question vectors (no chat model: every chat
 * check here is answered before generation — a held-back law short-circuits).
 * Exit 1 when a safety check FAILS (a corrupted text reachable by any route).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool, query } from "../src/lib/db";
import { describeTarget, targetLine } from "../src/lib/db-target";
import { foldForSearch, normalizeDigits } from "../src/lib/ingest/clean";
import { normalizeTitle } from "../src/lib/ingest/title";
import { assessArabicText } from "../src/lib/ingest/quality";
import { isServableSource } from "../src/lib/corpus/integrity";
import { expectedSourceType, sourceClassOf } from "../src/lib/corpus/source-class";
import { loadRegistry, matchRequiredLaw } from "../src/lib/corpus/inventory";
import { hybridSearch, getChunksByIds } from "../src/lib/search/hybrid";
import { verifyAndCleanCitations } from "../src/lib/ai/citation-verify";
import { env } from "../src/lib/env";

type Row = {
  id: number;
  title: string;
  source_type: string;
  status: string;
  jurisdiction: string;
  is_synthetic: boolean;
  integrity_status: string;
  gazette_status: string;
  provenance: string | null;
  issuing_authority: string | null;
  is_current_version: boolean;
  law_number: string | null;
  year: number | null;
  file_path: string | null;
  supersedes: number | null;
  amendment_of: number | null;
  replaced_by: number | null;
  chunks: number;
  sample: string;
};
type Check = { id: string; status: "PASS" | "FAIL" | "INFO"; detail: string };

const fold = (s: string) => foldForSearch(normalizeTitle(s)).replace(/\s+/g, " ").trim();
const checks: Check[] = [];
const add = (id: string, status: Check["status"], detail: string) => checks.push({ id, status, detail });

async function loadRows(): Promise<Row[]> {
  const rows = await query<Row & { id: string }>(
    `SELECT s.id, s.title, s.source_type, s.status, s.jurisdiction, s.is_synthetic, s.integrity_status, s.gazette_status, s.provenance,
            s.issuing_authority, s.is_current_version, s.law_number, s.year, s.file_path, s.supersedes, s.amendment_of, s.replaced_by,
            (SELECT count(*)::int FROM legal_documents d WHERE d.source_id = s.id) AS chunks,
            COALESCE((SELECT left(string_agg(d.chunk_text, E'\\n' ORDER BY d.chunk_index), 12000) FROM legal_documents d WHERE d.source_id = s.id), '') AS sample
       FROM legal_sources s ORDER BY s.id`
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), supersedes: r.supersedes === null ? null : Number(r.supersedes) }));
}

function state(r: Row) {
  const q = assessArabicText(r.sample);
  return {
    id: r.id,
    title: r.title,
    type: r.source_type,
    class: sourceClassOf(r.source_type, r.title),
    integrity: r.integrity_status,
    gazette: r.gazette_status,
    provenance: r.provenance ?? "not recorded",
    authority: r.issuing_authority,
    current: r.is_current_version,
    servable: isServableSource(r, false) && r.chunks > 0,
    number: r.law_number,
    year: r.year,
    chunks: r.chunks,
    orphanLetterRatio: Math.round(q.orphanLetterRatio * 1000) / 10,
    commonWords: q.distinctCommonWords,
    garbled: q.garbled,
    links: { supersedes: r.supersedes, amendment_of: r.amendment_of, replaced_by: r.replaced_by },
  };
}

async function chunkIds(sourceIds: number[]): Promise<number[]> {
  if (!sourceIds.length) return [];
  return (await query<{ id: string }>(`SELECT id FROM legal_documents WHERE source_id = ANY($1::bigint[])`, [sourceIds])).map((r) => Number(r.id));
}

async function reachable(question: string, ids: number[]): Promise<number[]> {
  const r = await hybridSearch(question);
  return [...new Set(r.chunks.map((c) => Number(c.source_id)).filter((id) => ids.includes(id)))];
}

async function main() {
  const target = describeTarget(process.env.DATABASE_URL ?? "");
  console.log(`Target: ${targetLine(target)}`);
  if (env.allowSyntheticCorpus) console.log("NOTE: ALLOW_SYNTHETIC_CORPUS is on — evaluation fixtures count as servable.");
  const rows = await loadRows();
  const registry = loadRegistry(resolve("deploy/sources/required-laws.json"));
  const titles = rows.map((r) => ({ id: r.id, folded: foldForSearch(r.title) }));
  const byLaw = (lawId: string) => {
    const law = registry.find((l) => l.id === lawId)!;
    return rows.filter((r) => matchRequiredLaw(law, titles).includes(r.id));
  };
  const out: Record<string, unknown> = { target, at: new Date().toISOString() };

  // ---- D1. Civil Code 43/1976
  const civil = byLaw("civil");
  const civilAmendments = rows.filter((r) => /^(?:قانون|نظام)\s+معد[ّ]?ل\s+لل?قانون\s+المدني/.test(fold(r.title)));
  out.civil = { sources: civil.map(state), amendments: civilAmendments.map(state) };
  const id2 = rows.find((r) => r.id === 2);
  add("civil.id2", "INFO", id2 ? `id 2 is "${id2.title}" — ${fold(id2.title).includes("المدني") ? "the Civil Code" : "NOT the Civil Code"}` : "no source 2 in this database");
  const corruptServable = civil.filter((r) => isServableSource(r, false) && (assessArabicText(r.sample).garbled || assessArabicText(r.sample).orphanLetterRatio > 0.05));
  add("civil.corrupted_not_servable", corruptServable.length ? "FAIL" : "PASS", corruptServable.length ? `servable corrupted text(s): ${corruptServable.map((r) => r.id).join(", ")}` : `no corrupted Civil Code text is servable (${civil.length} source(s) of the law)`);
  const clean = civil.filter((r) => isServableSource(r, false) && r.chunks > 0);
  add("civil.replacement", "INFO", clean.length ? `servable Civil Code text(s): ${clean.map((r) => `${r.id} (${r.provenance ?? "provenance not recorded"}, gazette ${r.gazette_status})`).join("; ")}` : "no servable Civil Code text in this database — no replacement candidate");
  add("civil.amendments", "INFO", civilAmendments.length ? `amending acts: ${civilAmendments.map((r) => `${r.id} ${r.title} (${r.integrity_status})`).join("; ")}` : "no amending act of the Civil Code in this database");
  const heldCivil = civil.filter((r) => !isServableSource(r, false)).map((r) => r.id);
  if (heldCivil.length) {
    const s = await hybridSearch("ما نص المادة 3 من القانون المدني؟");
    const leaked = s.chunks.filter((c) => heldCivil.includes(Number(c.source_id))).length;
    add("civil.named_question", leaked === 0 && (clean.length > 0 || s.requestedLawHeldBack) ? "PASS" : "FAIL",
      `named question: ${leaked} chunk(s) of a held-back text; ${s.requestedLawHeldBack ? `answered as held back (${s.requestedLawHeldBack.statuses.join(", ")})` : clean.length ? "answered from a servable text" : "NOT reported as held back"}`);
    const sample = rows.find((r) => r.id === heldCivil[0])!.sample.slice(0, 120);
    const viaOwnWords = await reachable(sample, heldCivil);
    add("civil.own_words", viaOwnWords.length ? "FAIL" : "PASS", `searched by its own stored words: ${viaOwnWords.length ? `REACHED ${viaOwnWords.join(", ")}` : "not reached"}`);
    const byId = await getChunksByIds(await chunkIds(heldCivil));
    add("civil.by_id", byId.length ? "FAIL" : "PASS", `client-supplied chunk ids: ${byId.length} returned`);
    const cite = await verifyAndCleanCitations("المادة 3 من القانون المدني رقم 43 لسنة 1976");
    add("civil.citation", cite.verifiedCount > 0 && clean.length === 0 ? "FAIL" : "PASS", `citation "القانون المدني رقم 43 لسنة 1976": ${cite.verifiedCount} verified`);
  }

  // ---- D2. Penal Code 16/1960 — ids 3 and 170
  const penal = byLaw("penal");
  out.penal = { sources: penal.map(state), id3: rows.find((r) => r.id === 3) ? state(rows.find((r) => r.id === 3)!) : null, id170: rows.find((r) => r.id === 170) ? state(rows.find((r) => r.id === 170)!) : null };
  const heldPenal = penal.filter((r) => !isServableSource(r, false)).map((r) => r.id);
  for (const q of ["ما نص المادة 2 من قانون العقوبات رقم 16 لسنة 1960 كما كان قبل التعديل؟", "ما عقوبة السرقة في قانون العقوبات القديم سنة 1960؟"]) {
    const hit = heldPenal.length ? await reachable(q, heldPenal) : [];
    add("penal.historical", hit.length ? "FAIL" : "PASS", `"${q}": ${hit.length ? `REACHED held-back ${hit.join(", ")}` : "no held-back Penal text reached"}`);
  }
  // ---- D3. Commercial / Labour / Companies — 159, 160, 161
  out.lob = [159, 160, 161].map((id) => rows.find((r) => r.id === id)).map((r) => (r ? state(r) : null));
  for (const id of [159, 160, 161]) {
    const r = rows.find((x) => x.id === id);
    add(`lob.${id}`, "INFO", r ? `${r.title}: provenance ${r.provenance ?? "not recorded"}${r.issuing_authority ? ` (${r.issuing_authority})` : ""}, integrity ${r.integrity_status}, gazette ${r.gazette_status}` : "absent");
  }

  // ---- D4. Labour article 138: text against text, never a guess
  const labour = byLaw("labour");
  const a138 = await query<{ source_id: string; chunk_text: string }>(
    `SELECT source_id, chunk_text FROM legal_documents WHERE source_id = ANY($1::bigint[]) AND regexp_replace(COALESCE(article_number, ''), '[^0-9]', '', 'g') = '138' ORDER BY source_id, chunk_index`,
    [labour.map((r) => r.id)]
  );
  const bySource = new Map<number, string>();
  for (const c of a138) bySource.set(Number(c.source_id), `${bySource.get(Number(c.source_id)) ?? ""} ${c.chunk_text}`);
  const norm = (t: string) => fold(normalizeDigits(t)).replace(/[^ء-ي0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const texts = [...bySource.entries()].map(([id, t]) => ({ id, text: norm(t) }));
  let verdict = "article 138 is held by fewer than two sources: nothing to compare";
  if (texts.length >= 2) {
    const [a, b] = texts;
    const wa = new Set(a.text.split(" "));
    const wb = new Set(b.text.split(" "));
    const overlap = [...wa].filter((w) => wb.has(w)).length / Math.max(1, Math.min(wa.size, wb.size));
    verdict =
      a.text === b.text
        ? `IDENTICAL after normalisation in sources ${a.id} and ${b.id}: a duplicate — a reviewer may replace one with the other`
        : a.text.includes(b.text) || b.text.includes(a.text)
          ? `one text CONTAINS the other (sources ${a.id}, ${b.id}): a partial duplicate — review`
          : `DIFFERENT texts (word overlap ${Math.round(overlap * 100)}%) in sources ${a.id} and ${b.id}: conflicting or another version — lawyer review`;
  }
  out.labour138 = { sources: labour.map(state), article138In: [...bySource.keys()], verdict };
  add("labour.138", "INFO", verdict);
  const currentLabour = labour.filter((r) => r.is_current_version && isServableSource(r, false) && !/معد[ّ]?ل/.test(fold(r.title)));
  add("labour.current_versions", currentLabour.length > 1 ? "INFO" : "PASS", `${currentLabour.length} servable "current" Labour text(s): ${currentLabour.map((r) => r.id).join(", ")}${currentLabour.length > 1 ? " — retrieval can serve both; settle by the comparison above" : ""}`);

  // ---- D5. Real Property
  const rp = byLaw("real-property");
  out.realProperty = rp.map(state);
  add("real_property", "INFO", rp.length ? rp.map((r) => `${r.id} "${r.title}" number ${r.law_number ?? "∅"} year ${r.year ?? "∅"} current ${r.is_current_version} ${r.integrity_status}`).join("; ") : "absent");

  // ---- D6. The three laws not proven present — by name, in any state
  const SEARCH: [string, string[]][] = [
    ["evidence", ["البينات"]],
    ["owners-tenants", ["المالكين والمستاجرين", "المالكين و المستاجرين"]],
    ["income-tax", ["ضريبه الدخل"]],
  ];
  out.notProven = {};
  for (const [lawId, keys] of SEARCH) {
    const exact = byLaw(lawId);
    const loose = rows.filter((r) => !exact.includes(r) && keys.some((k) => fold(r.title).includes(fold(k))));
    const found = [...exact, ...loose];
    const label = found.length === 0
      ? "ABSENT — no source of any status carries the law's name"
      : found.map((r) => `${r.id} "${r.title}" (${exact.includes(r) ? "matches the registry" : "name only — different title/number"}; ${r.status}/${r.integrity_status}; servable ${isServableSource(r, false)}; number ${r.law_number ?? "∅"} year ${r.year ?? "∅"})`).join("; ");
    (out.notProven as Record<string, unknown>)[lawId] = found.map(state);
    add(`not_proven.${lawId}`, "INFO", label);
  }

  // ---- E. Source classes and provenance
  const classCounts: Record<string, number> = {};
  for (const r of rows) classCounts[`${r.source_type}→${sourceClassOf(r.source_type, r.title)}`] = (classCounts[`${r.source_type}→${sourceClassOf(r.source_type, r.title)}`] ?? 0) + 1;
  const misfiled = rows.filter((r) => expectedSourceType(r.source_type, r.title));
  const templatesNotPleadings = rows.filter((r) => r.source_type === "template" && /^(?:ال)?لايحه(?!\s+(?:دعوي|الدعوي|جوابيه|استيناف|الاستيناف|اعتراض|طعن|تمييز))/.test(fold(r.title)));
  const executiveAsDecision = rows.filter((r) => r.source_type === "court_decision" && /^(?:ال)?قرار\s+ب(?:تحديد|تعيين|تنظيم|اصدار|شان)/.test(fold(r.title)));
  const jbaNoProvenance = rows.filter((r) => (r.file_path ?? "").includes("jba-decisions") && r.provenance !== "secondary");
  out.classes = { counts: classCounts, misfiled: misfiled.map(state), templatesNotPleadings: templatesNotPleadings.map(state), executiveAsDecision: executiveAsDecision.map(state), jbaNoProvenance: jbaNoProvenance.map(state) };
  add("classes.misfiled", misfiled.length ? "INFO" : "PASS", misfiled.length ? `${misfiled.length} source(s) whose title names another type: ${misfiled.map((r) => r.id).slice(0, 20).join(", ")}` : "every source type agrees with its title");
  add("classes.fee_schedules", templatesNotPleadings.length ? "INFO" : "PASS", `${templatesNotPleadings.length} non-pleading "لائحة" filed as template`);
  add("classes.executive_decisions", executiveAsDecision.length ? "INFO" : "PASS", `${executiveAsDecision.length} executive decision(s) filed as court decisions`);
  add("classes.jba_provenance", jbaNoProvenance.length ? "INFO" : "PASS", `${jbaNoProvenance.length} Bar Association republication(s) without secondary provenance`);

  out.checks = checks;
  const md = [
    `# Critical laws and source classes — ${out.at}`,
    "",
    `Target: ${targetLine(target)}`,
    "",
    "| Check | Status | Evidence from this database |",
    "|---|---|---|",
    ...checks.map((c) => `| ${c.id} | ${c.status} | ${c.detail.replace(/\|/g, "/")} |`),
    "",
  ].join("\n");
  const mdOut = process.argv.includes("--md") ? process.argv[process.argv.indexOf("--md") + 1] : null;
  const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
  if (mdOut) writeFileSync(mdOut, md);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  process.stdout.write(md);
  await getPool().end();
  process.exit(checks.some((c) => c.status === "FAIL") ? 1 : 0);
}

main().catch(async (err) => {
  console.error("critical-law checks failed:", (err as Error).message.replace(/\/\/[^@\s]+@/g, "//…@"));
  await getPool().end().catch(() => undefined);
  process.exit(2);
});
