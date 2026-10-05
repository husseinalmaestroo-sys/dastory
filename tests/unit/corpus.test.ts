import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeInventory, articleSequence, matchRequiredLaw, type InventoryChunks, type InventorySource, type RequiredLaw } from "@/lib/corpus/inventory";
import { authorityLevel, isAuthoritative, isServableSource, sameLawIdentity } from "@/lib/corpus/integrity";
import { matchProvenance, provenanceForUrl, storedNamesFor } from "@/lib/corpus/provenance";
import { fileNameFrom } from "@/lib/ingest/source-files";
import { foldForSearch } from "@/lib/ingest/clean";

// Phase 2.1 corpus layer (separate states since the 2026-10 corpus repair):
// the pure halves (no database). Titles are real Jordanian law names; texts
// are invented.

const src = (over: Partial<InventorySource> & { id: number; title: string }): InventorySource => ({
  source_type: "law",
  status: "ready",
  jurisdiction: "JO",
  language: "ar",
  provenance: "secondary",
  source_url: "https://www.moj.gov.jo/x.pdf",
  issuing_authority: null,
  integrity_status: "passed",
  gazette_status: "unverified",
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
  assert.equal(row("penal").status, "served_not_gazette_verified");
  assert.deepEqual(row("penal").sourceIds.sort(), [1, 2]);
  // The inventory reports what it sees; the integrity status alone decides
  // what is served — the check (corpus/check.ts) is what quarantines it.
  assert.equal(row("labour").status, "served_not_gazette_verified", "a garbled text marked passed is flagged, and served until quarantined");
  assert.ok(row("labour").sourceIds.includes(4), "an amending act belongs to its law");
  assert.equal(row("arb").status, "held_back");
  assert.deepEqual([row("arb").presentInDatabase, row("arb").servable, row("arb").integrity.quarantined], [true, false, 1]);
  assert.ok(report.anomalies.some((a) => a.kind === "law_not_servable" && a.law === "قانون التحكيم"));
  assert.equal(report.summary.authoritative, 0, "nothing Gazette-verified");
  assert.equal(report.summary.byIntegrity.quarantined, 2);
});

test("coverage: every state on its own — an official text is not Gazette-verified; only a Gazette-verified one is authoritative", () => {
  const at = (over: Partial<InventorySource>) =>
    analyzeInventory({
      sources: [src({ id: 1, title: "قانون العقوبات رقم 16 لسنة 1960", provenance: "official", ...over })],
      chunks: [chunks(1)],
      orphanChunks: 0,
      registry: [PENAL, LABOUR],
      servedModel: "text-embedding-3-small",
    });
  const states = (c: ReturnType<typeof at>["coverage"][number]) =>
    [c.status, c.presentInDatabase, c.servable, c.officialSource, c.gazetteVerified, c.currentVersion, c.embedded, c.searchable, c.authoritative, c.metadataComplete];

  // From the Legislation Bureau, integrity passed: an OFFICIAL SOURCE — and not Gazette-verified, so not authoritative.
  const official = at({}).coverage.find((c) => c.law.id === "penal")!;
  assert.deepEqual(states(official), ["served_not_gazette_verified", true, true, true, false, true, true, true, false, true]);
  // Compared with the Official Gazette (with a reference): authoritative.
  const gazette = at({ gazette_status: "verified" }).coverage.find((c) => c.law.id === "penal")!;
  assert.deepEqual(states(gazette), ["authoritative", true, true, true, true, true, true, true, true, true]);
  // A secondary republication later compared with the Gazette: authoritative, and still secondary.
  const republished = at({ provenance: "secondary", gazette_status: "verified" });
  assert.deepEqual(states(republished.coverage.find((c) => c.law.id === "penal")!).slice(0, 5), ["authoritative", true, true, false, true]);
  assert.equal(republished.sources[0].authorityLevel, "gazette_verified");
  // Gazette-verified once, then quarantined: present, held back, nothing claimed.
  const quarantined = at({ gazette_status: "verified", integrity_status: "quarantined" }).coverage.find((c) => c.law.id === "penal")!;
  assert.deepEqual(states(quarantined), ["held_back", true, false, false, false, false, false, false, false, false]);
  // Never checked: present, not served.
  const unchecked = at({ integrity_status: "unchecked" });
  assert.equal(unchecked.coverage.find((c) => c.law.id === "penal")!.status, "held_back");
  assert.ok(unchecked.sources[0].anomalies.some((a) => a.kind === "integrity_unchecked"));
  // A superseded text only: present and served for history, but no CURRENT VERSION.
  const old = at({ is_current_version: false }).coverage.find((c) => c.law.id === "penal")!;
  assert.deepEqual([old.servable, old.currentVersion], [true, false]);

  const labour = at({}).coverage.find((c) => c.law.id === "labour")!;
  assert.equal(labour.status, "absent");
  assert.ok(at({}).anomalies.some((a) => a.kind === "missing_law" && a.severity === "critical" && a.law === "قانون العمل"));
});

test("inventory: damaged titles, incomplete metadata, misfiled classes, unlinked amendments and duplicate content are reported", () => {
  const report = analyzeInventory({
    sources: [
      src({ id: 1, title: "قانون الملكية العقارية لسنة أحكام عامة" }),
      src({ id: 2, title: "قانــــون العفو العام رقـم 5 لسنـــــة 2024" }),
      src({ id: 3, title: "مذكرة تفاهم بين وزارة العدل ونقابة المحامين", source_type: "instruction" }),
      src({ id: 4, title: "قرار الديوان الخاص بتفسير القوانين رقم 3 لسنة 2010", source_type: "principle" }),
      src({ id: 5, title: "قانون معدل لقانون العمل رقم 14 لسنة 2019", amendment_of: null }),
      src({ id: 6, title: "نظام رسوم الكاتب العدل رقم 1 لسنة 2020", file_hash: "h6" }),
      src({ id: 7, title: "نظام رسوم الكاتب العدل رقم 1 لسنة 2020 (نسخة)", file_hash: "h7" }),
    ],
    chunks: [1, 2, 3, 4, 5].map((id) => chunks(id)).concat([chunks(6, { sample_text: CLEAN_TEXT.repeat(2) }), chunks(7, { sample_text: CLEAN_TEXT.repeat(2) })]),
    orphanChunks: 0,
    registry: [{ id: "rp", name: "قانون الملكية العقارية", kind: "قانون", number: "13", year: 2019, priority: "P1", category: "مدنية", basis: "missing-list" }],
    servedModel: "text-embedding-3-small",
  });
  const kinds = (id: number) => report.sources.find((s) => s.id === id)!.anomalies.map((a) => a.kind);
  assert.ok(kinds(1).includes("malformed_title") && kinds(1).includes("metadata_incomplete"), JSON.stringify(kinds(1)));
  assert.equal(report.sources.find((s) => s.id === 1)!.metadataComplete, false, "no number or year is invented for it");
  assert.ok(kinds(2).includes("malformed_title"), "tatweel is reported for normalize-titles");
  assert.equal(report.sources.find((s) => s.id === 2)!.number, "5", "tatweel no longer hides the law number");
  assert.equal(report.sources.find((s) => s.id === 2)!.year, 2024);
  assert.ok(kinds(3).includes("source_class_mismatch"));
  assert.equal(report.sources.find((s) => s.id === 3)!.sourceClass, "mou", "classified as a memorandum even before the reclassification");
  assert.equal(report.sources.find((s) => s.id === 4)!.sourceClass, "interpretation");
  assert.ok(kinds(5).includes("amendment_unlinked"));
  assert.ok(report.anomalies.some((a) => a.kind === "duplicate_content" && a.detail.includes("6, 7")), JSON.stringify(report.anomalies.filter((a) => !a.sourceId)));
  // The damaged title still belongs to its law, by name.
  assert.deepEqual(report.coverage[0].sourceIds, [1]);
  assert.equal(report.coverage[0].metadataComplete, false);
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

test("authority: Gazette-verified + integrity passed + not a fixture — provenance alone never; replacement must be the same law", () => {
  const s = (provenance: string | null, integrity_status: string, gazette_status: string, is_synthetic = false) => ({ provenance, integrity_status, gazette_status, is_synthetic });
  // The Legislation Bureau's text: an official source, NOT Gazette-verified.
  assert.equal(isAuthoritative(s("official", "passed", "unverified")), false);
  assert.equal(authorityLevel(s("official", "passed", "unverified")), "official_not_verified");
  assert.equal(isAuthoritative(s("official", "passed", "verified")), true);
  // A Ministry of Justice republication, later compared with the Gazette: verified, still secondary.
  assert.equal(isAuthoritative(s("secondary", "passed", "verified")), true);
  assert.equal(authorityLevel(s("secondary", "passed", "unverified")), "secondary_not_verified");
  assert.equal(authorityLevel(s(null, "passed", "unverified")), "unrecorded_not_verified");
  // A Gazette verification never survives a failed text, and never makes a fixture law.
  assert.equal(isAuthoritative(s("official", "quarantined", "verified")), false);
  assert.equal(isAuthoritative(s("official", "unchecked", "verified")), false);
  assert.equal(isAuthoritative(s("official", "passed", "verified", true)), false);
  assert.equal(authorityLevel(s("synthetic", "passed", "verified", true)), "synthetic");
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

test("servable: ready, Jordanian, not a fixture (unless allowed), integrity passed — every other state is never served", () => {
  const ok = { status: "ready", jurisdiction: "JO", is_synthetic: false, integrity_status: "passed" };
  assert.equal(isServableSource(ok, false), true);
  for (const [field, value] of [
    ["integrity_status", "unchecked"],
    ["integrity_status", "quarantined"],
    ["integrity_status", "replaced"],
    ["status", "processing"],
    ["status", "failed"],
    ["jurisdiction", "EG"],
    ["is_synthetic", true],
  ] as const) {
    assert.equal(isServableSource({ ...ok, [field]: value }, false), false, `${field}=${value}`);
  }
  assert.equal(isServableSource({ ...ok, is_synthetic: true }, true), true, "fixtures only when ALLOW_SYNTHETIC_CORPUS");
  assert.equal(isServableSource({ ...ok, is_synthetic: true, integrity_status: "quarantined" }, true), false);
});
