import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeInventory, articleSequence, matchRequiredLaw, type InventoryChunks, type InventorySource, type RequiredLaw } from "@/lib/corpus/inventory";
import { isAuthoritative, sameLawIdentity } from "@/lib/corpus/integrity";
import { matchProvenance, provenanceForUrl, storedNamesFor } from "@/lib/corpus/provenance";
import { fileNameFrom } from "@/lib/ingest/source-files";
import { foldForSearch } from "@/lib/ingest/clean";

// Phase 2.1 corpus layer: the pure halves (no database). Titles are real
// Jordanian law names; texts are invented.

const src = (over: Partial<InventorySource> & { id: number; title: string }): InventorySource => ({
  source_type: "law",
  status: "ready",
  jurisdiction: "JO",
  language: "ar",
  provenance: "secondary",
  source_url: "https://www.moj.gov.jo/x.pdf",
  issuing_authority: null,
  integrity_status: "unverified",
  is_current_version: true,
  supersedes: null,
  amendment_of: null,
  law_number: null,
  effective_date: "1960-01-01",
  file_hash: null,
  chunk_count: 3,
  is_synthetic: false,
  ...over,
});

const CLEAN_TEXT =
  "المادة 1: يسمى هذا القانون قانون العقوبات ويعمل به من تاريخ نشره في الجريدة الرسمية. " +
  "المادة 2: يعاقب على الجرائم المرتكبة في المملكة وفق أحكام هذا القانون، ولا يجوز أن يعاقب أحد على فعل لم يكن مجرماً عند ارتكابه. " +
  "المادة 3: تسري أحكام هذا القانون على كل من يرتكب جرماً داخل المملكة، ما لم ينص قانون خاص على غير ذلك، ومع مراعاة الاتفاقيات الدولية التي تكون المملكة طرفاً فيها. " +
  "المادة 4: تتولى المحكمة المختصة النظر في الدعوى وفق الأصول المقررة في قانون أصول المحاكمات الجزائية.";
// Every Arabic letter substituted — what a PDF with a broken font map extracts.
const GARBLED = [...CLEAN_TEXT].map((ch) => {
  const c = ch.charCodeAt(0);
  return c >= 0x0621 && c <= 0x064a ? String.fromCharCode(0x0621 + (((c - 0x0621) * 5 + 11) % 42)) : ch;
}).join("");

const chunks = (source_id: number, over: Partial<InventoryChunks> = {}): InventoryChunks => ({
  source_id,
  chunks: 3,
  embedded: 3,
  models: ["text-embedding-3-small"],
  articles: ["1", "2", "3"],
  sample_text: CLEAN_TEXT,
  ...over,
});

const PENAL: RequiredLaw = { id: "penal", name: "قانون العقوبات", kind: "قانون", number: "16", year: 1960, priority: "P0", category: "جزائية", basis: "test" };
const LABOUR: RequiredLaw = { id: "labour", name: "قانون العمل", kind: "قانون", number: "8", year: 1996, priority: "P0", category: "عمالية", basis: "test" };
const ARBITRATION: RequiredLaw = { id: "arb", name: "قانون التحكيم", kind: "قانون", number: "31", year: 2001, priority: "P1", category: "تجارية", basis: "test" };

test("article numbering: parts of one article collapse; gaps, repeats and reversals are found", () => {
  const ok = articleSequence(["1", "2", "2", "3", "4"]);
  assert.deepEqual([ok.gaps, ok.duplicates, ok.outOfOrder], [[], [], 0]);
  const broken = articleSequence(["1", "2", "5", "6", "2", "9", null]);
  assert.deepEqual(broken.gaps, [3, 4, 7, 8]);
  assert.deepEqual(broken.duplicates, ["2"]);
  assert.equal(broken.outOfOrder, 1);
  assert.equal(broken.unnumbered, 1);
  assert.equal(articleSequence(["17 مكرر", "18"]).distinct, 2);
});

test("inventory: damaged text, vectors and metadata are anomalies; the required-law matrix follows the sources", () => {
  const report = analyzeInventory({
    sources: [
      src({ id: 1, title: "قانون العقوبات وتعديلاته رقم 16 لسنة 1960", file_hash: "aaa" }),
      src({ id: 2, title: "قانون العقوبات رقم 16 لسنة 1960", file_hash: "aaa" }), // same file, same law, both "current"
      src({ id: 3, title: "قانون العمل رقم 8 لسنة 1996", provenance: null }),
      src({ id: 4, title: "قانون معدل لقانون العمل رقم 14 لسنة 2019", integrity_status: "quarantined" }),
      src({ id: 5, title: "قانون التحكيم رقم 31 لسنة 2001", integrity_status: "quarantined" }),
      src({ id: 6, title: "مصدر اصطناعي", provenance: "official", is_synthetic: true }),
    ],
    chunks: [
      chunks(1),
      chunks(2, { embedded: 2, models: ["text-embedding-3-small", "text-embedding-ada-002"] }),
      chunks(3, { sample_text: GARBLED, articles: [null, null, null] }),
      chunks(4),
      chunks(5, { articles: ["1", "7", "9"] }),
      chunks(6),
    ],
    orphanChunks: 2,
    registry: [PENAL, LABOUR, ARBITRATION],
    servedModel: "text-embedding-3-small",
  });
  const kinds = (id: number) => report.sources.find((s) => s.id === id)!.anomalies.map((a) => a.kind);
  assert.ok(kinds(2).includes("missing_embeddings") && kinds(2).includes("mixed_embedding_models") && kinds(2).includes("stale_embedding_model"));
  assert.ok(kinds(3).includes("garbled_text"), "a broken font map is caught");
  assert.ok(kinds(3).includes("unnumbered_articles") && kinds(3).includes("provenance_unrecorded"));
  assert.ok(kinds(5).includes("article_gaps"));
  assert.ok(kinds(6).includes("invalid_metadata"), "a fixture must be marked synthetic");
  const global = report.anomalies.filter((a) => !a.sourceId).map((a) => a.kind);
  assert.ok(global.includes("duplicate_file") && global.includes("multiple_current_versions") && global.includes("orphan_chunks"));

  const row = (id: string) => report.coverage.find((c) => c.law.id === id)!;
  assert.equal(row("penal").status, "served_unverified");
  assert.deepEqual(row("penal").sourceIds.sort(), [1, 2]);
  assert.equal(row("labour").status, "served_unverified", "the garbled labour law is still servable until quarantined");
  assert.ok(row("labour").sourceIds.includes(4), "an amending act belongs to its law");
  assert.equal(row("arb").status, "quarantined_only");
  assert.equal(row("arb").servable, false);
  assert.ok(report.anomalies.some((a) => a.kind === "law_not_servable" && a.law === "قانون التحكيم"));
  assert.equal(report.summary.authoritative, 0, "nothing official and verified");
});

test("coverage: an official, verified, current, embedded source is authoritative; an absent law is unavailable", () => {
  const report = analyzeInventory({
    sources: [src({ id: 1, title: "قانون العقوبات رقم 16 لسنة 1960", provenance: "official", integrity_status: "verified" })],
    chunks: [chunks(1)],
    orphanChunks: 0,
    registry: [PENAL, LABOUR],
    servedModel: "text-embedding-3-small",
  });
  const penal = report.coverage.find((c) => c.law.id === "penal")!;
  assert.deepEqual([penal.status, penal.official, penal.verified, penal.current, penal.embedded, penal.searchable], ["authoritative", true, true, true, true, true]);
  const labour = report.coverage.find((c) => c.law.id === "labour")!;
  assert.equal(labour.status, "unavailable");
  assert.ok(report.anomalies.some((a) => a.kind === "missing_law" && a.severity === "critical" && a.law === "قانون العمل"));
});

test("required-law matching: by number and year, never a regulation or another law's same number", () => {
  const titles = [
    { id: 1, folded: foldForSearch("قانون العقوبات وتعديلاته رقم 16 لسنة 1960") },
    { id: 2, folded: foldForSearch("نظام رقم 16 لسنة 1960") },
    { id: 3, folded: foldForSearch("قانون معدل لقانون العقوبات رقم 10 لسنة 2022") },
    { id: 4, folded: foldForSearch("قانون الجمارك رقم 16 لسنة 1983") },
    { id: 5, folded: foldForSearch("الدستور الأردني - الفصل الأول") },
  ];
  assert.deepEqual(matchRequiredLaw(PENAL, titles).sort(), [1, 3]);
  assert.deepEqual(matchRequiredLaw({ ...PENAL, id: "c", name: "الدستور", kind: "الدستور", number: undefined, year: undefined }, titles), [5]);
});

test("authority: official + verified + not a fixture; replacement must be the same law", () => {
  assert.equal(isAuthoritative({ provenance: "official", integrity_status: "verified", is_synthetic: false }), true);
  assert.equal(isAuthoritative({ provenance: "official", integrity_status: "unverified", is_synthetic: false }), false);
  assert.equal(isAuthoritative({ provenance: "secondary", integrity_status: "verified", is_synthetic: false }), false);
  assert.equal(isAuthoritative({ provenance: "official", integrity_status: "verified", is_synthetic: true }), false);
  assert.equal(sameLawIdentity("قانون العمل رقم 8 لسنة 1996", "قانون العمل وتعديلاته رقم 8 لسنة 1996").ok, true);
  assert.equal(sameLawIdentity("قانون العمل رقم 8 لسنة 1996", "قانون العمل رقم 9 لسنة 1996").ok, false);
  assert.equal(sameLawIdentity("قانون العمل رقم 8 لسنة 1996", "قانون العمل رقم 8 لسنة 1997").ok, false);
  assert.equal(sameLawIdentity("قانون العمل", "قانون التحكيم").ok, false);
});

test("provenance: the publisher decides; a stored file finds its URL again (ambiguous names are left alone)", () => {
  assert.equal(provenanceForUrl("https://www.lob.gov.jo/x")?.provenance, "official");
  assert.equal(provenanceForUrl("https://www.jc.jo/AR/ListDetails/a/2199/2087")?.provenance, "official");
  assert.equal(provenanceForUrl("https://www.moj.gov.jo/ebv4.0/root_storage/ar/eb_list_page/x.pdf")?.provenance, "secondary");
  assert.equal(provenanceForUrl("https://example.com/x.pdf"), null);
  assert.equal(provenanceForUrl("not a url"), null);

  const pdf = "https://www.moj.gov.jo/ebv4.0/root_storage/ar/eb_list_page/قانون_العقوبات_وتعديلاته_رقم_16_لسنة_1960.pdf";
  assert.equal(fileNameFrom(pdf), "قانون_العقوبات_وتعديلاته_رقم_16_لسنة_1960.pdf");
  assert.ok(storedNamesFor("https://www.jc.jo/AR/ListDetails/x/2199/2087").includes("2087.txt"));

  const matches = matchProvenance(
    [
      { id: 1, file_path: `/data/moj/${fileNameFrom(pdf)}` },
      { id: 2, file_path: "/data/jc/2087.txt" },
      { id: 3, file_path: "/data/jba/45.txt" },
      { id: 4, file_path: null },
    ],
    [pdf, "https://www.jc.jo/AR/ListDetails/x/2199/2087", "https://www.jc.jo/AR/ListDetails/x/2199/45", "https://www.jba.org.jo/AR/ListDetails/y/45"]
  );
  assert.deepEqual(
    matches.map((m) => [m.sourceId, m.provenance]),
    [
      [1, "secondary"],
      [2, "official"],
    ],
    "45.txt is listed under two URLs: ambiguous, not guessed"
  );
});
