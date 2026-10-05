import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestEnv, serviceCaller } from "./helpers";
import { getPool, query, queryOne } from "@/lib/db";
import { loadEvalFixtures } from "../../scripts/load-eval-fixtures";
import { hybridSearch, getChunksByIds } from "@/lib/search/hybrid";
import { resetLawTitleCache } from "@/lib/search/law-reference";
import { runChatPipeline } from "@/lib/ai/pipelines/chat";
import { ingestSource } from "@/lib/ingest/pipeline";
import { setGazetteStatus, setIntegrity, replaceSource } from "@/lib/corpus/integrity";
import { analyzeInventory, loadInventoryInput, type RequiredLaw } from "@/lib/corpus/inventory";
import { autoQuarantine } from "@/lib/corpus/maintenance";
import { corpusVersion, resetVersionCaches } from "@/lib/ai/versioning";
import { GROUNDED_ANSWER_DISCLAIMER, GROUNDED_UNVERIFIED_DISCLAIMER, UNVERIFIED_SOURCES_SENTENCE } from "@/lib/ai/prompts";

/**
 * Phase 2.1 corpus integrity (separate states since the 2026-10 corpus
 * repair) against the real schema and the synthetic corpus: a quarantined or
 * replaced text is never served, every change is audited, damaged texts are
 * found — at ingest — and an answer says whether its sources were compared
 * with the Official Gazette.
 */
useTestEnv();

let ids: Record<string, number> = {};
const dir = mkdtempSync(join(tmpdir(), "corpus-test-"));
const created: number[] = [];

before(async () => {
  ids = await loadEvalFixtures({ quiet: true });
  resetLawTitleCache();
});
after(async () => {
  if (created.length) await query(`DELETE FROM legal_sources WHERE id = ANY($1::bigint[])`, [created]);
  rmSync(dir, { recursive: true, force: true });
  await getPool().end();
});

const A = () => serviceCaller("office-corpus", "user-1");
const garble = (t: string) =>
  [...t].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x0621 && c <= 0x064a ? String.fromCharCode(0x0621 + (((c - 0x0621) * 5 + 11) % 42)) : ch;
  }).join("");

/** A synthetic source ingested through the real pipeline, which checks it (deleted after the file). */
async function ingestFixture(title: string, text: string, integrity = "unchecked"): Promise<number> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO legal_sources (title, source_type, status, effective_date, is_current_version, jurisdiction, language, provenance, is_synthetic, integrity_status)
     VALUES ($1, 'law', 'pending', '2099-01-01', true, 'JO', 'ar', 'synthetic', true, $2) RETURNING id`,
    [title, integrity]
  );
  const id = Number(row!.id);
  created.push(id);
  const file = join(dir, `${id}.txt`);
  writeFileSync(file, text, "utf8");
  await ingestSource({ sourceId: id, filePath: file, title, sourceType: "law", court: null, year: null });
  return id;
}

const fromSource = (chunks: { source_id: number | string }[], id: number) => chunks.some((c) => Number(c.source_id) === id);

test("a quarantined text is never served: not by search, not by lookup, not by id", async () => {
  const q = ids.corrupt_quarantined;
  assert.ok(q, "fixture loaded");
  const r = await hybridSearch("ما عقوبة إلقاء النفايات في الطريق العام في قانون المخالفات التجريبي؟");
  assert.ok(!fromSource(r.chunks, q));
  const garbledWords = (await queryOne<{ t: string }>(`SELECT left(chunk_text, 80) AS t FROM legal_documents WHERE source_id = $1`, [q]))!.t;
  assert.ok(!fromSource((await hybridSearch(garbledWords)).chunks, q), "not even when searched by its own (garbled) words");
  // The law is in the database, but its only text is held back: the answer
  // says so explicitly — "unavailable", not "not in the database", and never
  // a quote of the damaged text.
  const lookup = await runChatPipeline({ question: "ما نص المادة 2 من قانون المخالفات التجريبي؟" }, A());
  assert.equal(lookup.mode, "law_unavailable", lookup.answer);
  assert.match(lookup.answer, /غير متاح|محجوب/);
  assert.deepEqual(lookup.sources, []);
  const chunkIds = (await query<{ id: string }>(`SELECT id FROM legal_documents WHERE source_id = $1`, [q])).map((x) => Number(x.id));
  assert.deepEqual(await getChunksByIds(chunkIds), [], "a client-supplied id cannot reach it either");
});

test("quarantine takes a served source out of service and back, with an audit trail and a new corpus version", async () => {
  const id = ids.companies;
  const question = "ما الحد الأدنى لرأس مال الشركة ذات المسؤولية المحدودة في قانون الشركات التجريبي؟";
  assert.ok(fromSource((await hybridSearch(question)).chunks, id), "served before");
  resetVersionCaches();
  const before = await corpusVersion();
  try {
    const r = await setIntegrity(id, "quarantined", { actor: "integration-test", reason: "suspected truncation (test)" });
    assert.deepEqual(r, { from: "passed", to: "quarantined" }, "the ingest's check passed the fixture");
    resetLawTitleCache();
    resetVersionCaches();
    assert.ok(!fromSource((await hybridSearch(question)).chunks, id), "not served while quarantined");
    assert.notEqual(await corpusVersion(), before, "answers are traceable to a different corpus");
    const lookup = await runChatPipeline({ question: "ما نص المادة 17 من قانون الشركات التجريبي؟" }, A());
    assert.equal(lookup.mode, "law_unavailable", "a quarantined law is held back, and said to be");
  } finally {
    await setIntegrity(id, "passed", { actor: "integration-test", reason: "restored (test)" });
    resetLawTitleCache();
  }
  assert.ok(fromSource((await hybridSearch(question)).chunks, id), "served again");
  const events = await query<{ from_status: string; to_status: string; actor: string; kind: string }>(
    `SELECT from_status, to_status, actor, kind FROM corpus_integrity_events WHERE source_id = $1 ORDER BY id DESC LIMIT 2`,
    [id]
  );
  assert.deepEqual(events.map((e) => `${e.kind}:${e.from_status}>${e.to_status}`), ["integrity:quarantined>passed", "integrity:passed>quarantined"]);
  await assert.rejects(setGazetteStatus(id, "verified", { actor: "t", reason: "looks fine" }), /evidence/, "a Gazette verification needs the Gazette reference");
  await assert.rejects(setIntegrity(id, "replaced", { actor: "t", reason: "x" }), /replaceSource/);
  await assert.rejects(setIntegrity(id, "quarantined", { actor: "", reason: "x" }), /actor/);
});

test("a repaired re-ingest replaces a damaged text: the old one is kept, never served; the new one takes its place", async () => {
  const clean =
    "المادة 1: يسمى هذا القانون قانون الرسوم البلدية التجريبي لسنة 2099 ويعمل به من تاريخ نشره في الجريدة الرسمية.\n" +
    "المادة 2: يستوفى رسم ترخيص سنوي عن كل محل تجاري قدره خمسون ديناراً، ويستوفى نصف الرسم إذا كان المحل في منطقة ريفية.\n" +
    "المادة 3: يدفع الرسم خلال الشهر الأول من السنة المالية، ويستوفى عن كل شهر تأخير ما نسبته واحد بالمئة من قيمة الرسم.\n" +
    "المادة 4: تعفى من الرسم المحال التي تديرها الجمعيات الخيرية المسجلة وفق أحكام التشريعات النافذة.";
  const damaged = await ingestFixture("قانون الرسوم البلدية التجريبي رقم 21 لسنة 2099", garble(clean).repeat(3));
  const atIngest = await queryOne<{ integrity_status: string }>(`SELECT integrity_status FROM legal_sources WHERE id = $1`, [damaged]);
  assert.equal(atIngest!.integrity_status, "quarantined", "the ingest's own check quarantines a garbled text before anything can serve it");
  const repaired = await ingestFixture("قانون الرسوم البلدية التجريبي وتعديلاته رقم 21 لسنة 2099", clean);
  const other = await ingestFixture(
    "قانون السير التجريبي رقم 22 لسنة 2099",
    "المادة 1: يسمى هذا القانون قانون السير التجريبي لسنة 2099 ويعمل به من تاريخ نشره في الجريدة الرسمية.\n" +
      "المادة 2: يعاقب بغرامة لا تقل عن عشرين ديناراً كل من قاد مركبة دون رخصة قيادة سارية المفعول صادرة عن الجهة المختصة."
  );
  await assert.rejects(replaceSource(damaged, other, { actor: "t", reason: "x" }), /not the same law/);

  await replaceSource(damaged, repaired, { actor: "integration-test", reason: "garbled extraction", evidence: "sha256:test-official-file" });
  const rows = await query<{ id: string; integrity_status: string; replaced_by: string | null; is_current_version: boolean }>(
    `SELECT id, integrity_status, replaced_by, is_current_version FROM legal_sources WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [[damaged, repaired]]
  );
  assert.deepEqual(
    rows.map((r) => [Number(r.id), r.integrity_status, r.replaced_by === null ? null : Number(r.replaced_by), r.is_current_version]),
    [
      [damaged, "replaced", repaired, false],
      [repaired, "passed", null, true],
    ]
  );
  const r = await hybridSearch("ما رسم ترخيص المحل التجاري في قانون الرسوم البلدية التجريبي؟");
  assert.ok(fromSource(r.chunks, repaired) && !fromSource(r.chunks, damaged));
  const events = await query<{ source_id: string; actor: string }>(`SELECT source_id, actor FROM corpus_integrity_events WHERE source_id = ANY($1::bigint[])`, [[damaged, repaired]]);
  const manual = events.filter((e) => e.actor === "integration-test");
  assert.equal(manual.length, 2, "both sides of the replacement are logged");
  assert.equal(events.filter((e) => e.actor === "ingest (automatic)").length, 2, "and each ingest's own check");
  assert.ok((await queryOne(`SELECT 1 FROM legal_documents WHERE source_id = $1 LIMIT 1`, [damaged])) !== null, "the damaged text is kept, not deleted");
});

test("the inventory finds a damaged text and reports coverage; auto-quarantine takes a damaged served text out", async () => {
  const registry: RequiredLaw[] = [
    { id: "labour", name: "قانون العمل التجريبي", kind: "قانون", number: "9", year: 2099, priority: "P0", category: "عمالية", basis: "test" },
    { id: "offences", name: "قانون المخالفات التجريبي", kind: "قانون", number: "13", year: 2099, priority: "P0", category: "جزائية", basis: "test" },
    { id: "absent", name: "قانون التحكيم التجريبي", kind: "قانون", number: "31", year: 2099, priority: "P1", category: "تجارية", basis: "test" },
  ];
  const report = analyzeInventory({ ...(await loadInventoryInput(getPool())), registry, servedModel: "test-hash-embed-v1", includeSynthetic: true });
  const corrupt = report.sources.find((s) => s.id === ids.corrupt_quarantined)!;
  assert.ok(corrupt.anomalies.some((a) => a.kind === "garbled_text"), JSON.stringify(corrupt.anomalies));
  assert.equal(corrupt.servable, false);
  const status = (id: string) => report.coverage.find((c) => c.law.id === id)!.status;
  assert.deepEqual([status("labour"), status("offences"), status("absent")], ["served_not_gazette_verified", "held_back", "absent"]);
  const offences = report.coverage.find((c) => c.law.id === "offences")!;
  assert.deepEqual([offences.presentInDatabase, offences.servable, offences.integrity.quarantined], [true, false, 1], "present, and held back — two separate states");

  // A text that passed and was later damaged (a bad re-extraction written over
  // its chunks): the recheck finds it and takes it out of service.
  const bad = await ingestFixture(
    "قانون الصيد التجريبي رقم 30 لسنة 2099",
    "المادة 1: يحظر الصيد في المحميات الطبيعية في جميع أوقات السنة، ويعاقب المخالف بغرامة لا تقل عن مئة دينار، وتضاعف الغرامة عند التكرار خلال سنة من تاريخ المخالفة الأولى.\n".repeat(8)
  );
  assert.equal((await queryOne<{ s: string }>(`SELECT integrity_status AS s FROM legal_sources WHERE id = $1`, [bad]))!.s, "passed");
  await query(`UPDATE legal_documents SET chunk_text = $2 WHERE source_id = $1`, [bad, garble("المادة 1: يحظر الصيد في المحميات الطبيعية في جميع أوقات السنة، ويعاقب المخالف بغرامة لا تقل عن مئة دينار. ").repeat(12)]);
  const dry = await autoQuarantine("integration-test", false);
  assert.ok(dry.some((t) => t.sourceId === bad), JSON.stringify(dry));
  assert.ok(!dry.some((t) => t.sourceId === ids.lease), "a clean text is left alone");
  assert.equal((await queryOne<{ s: string }>(`SELECT integrity_status AS s FROM legal_sources WHERE id = $1`, [bad]))!.s, "passed", "a dry run writes nothing");
  await autoQuarantine("integration-test", true);
  const s = await queryOne<{ integrity_status: string }>(`SELECT integrity_status FROM legal_sources WHERE id = $1`, [bad]);
  assert.equal(s!.integrity_status, "quarantined");
});

test("an answer says whether its sources were compared with the Official Gazette — an official source alone is not", async () => {
  const id = ids.companies;
  const question = "ما الحد الأدنى لرأس مال الشركة ذات المسؤولية المحدودة في قانون الشركات التجريبي؟";
  const unverified = await runChatPipeline({ question }, A());
  assert.ok(unverified.grounded, unverified.answer);
  assert.equal(unverified.sourceAuthority, "unverified");
  assert.ok(unverified.sources.every((s) => s.authoritative === false));
  assert.ok(
    unverified.disclaimer === GROUNDED_UNVERIFIED_DISCLAIMER || unverified.disclaimer?.includes(UNVERIFIED_SOURCES_SENTENCE),
    unverified.disclaimer
  );
  try {
    // From the official publisher (e.g. the Legislation Bureau), integrity
    // passed — and never compared with the Gazette: still not authoritative.
    await query(
      `UPDATE legal_sources SET provenance = 'official', is_synthetic = false, source_url = 'https://example.invalid/companies' WHERE id = $1`,
      [id]
    );
    resetLawTitleCache();
    const official = await runChatPipeline({ question }, A());
    assert.equal(official.sourceAuthority, "unverified", "official provenance is not a Gazette verification");
    assert.ok(official.sources.filter((s) => s.cited).every((s) => s.authorityLevel === "official_not_verified" && !s.authoritative));
    assert.notEqual(official.disclaimer, GROUNDED_ANSWER_DISCLAIMER);

    await setGazetteStatus(id, "verified", { actor: "integration-test", reason: "compared with the Gazette (test)", evidence: "الجريدة الرسمية عدد 9999 صفحة 1 (test)" });
    const verified = await runChatPipeline({ question }, A());
    assert.equal(verified.sourceAuthority, "verified", JSON.stringify(verified.sources.map((s) => [s.title, s.cited, s.authoritative])));
    assert.ok(verified.sources.filter((s) => s.cited).every((s) => s.authoritative && s.authorityLevel === "gazette_verified" && s.gazetteStatus === "verified"));
    if (verified.groundingLevel === "full") assert.equal(verified.disclaimer, GROUNDED_ANSWER_DISCLAIMER);
  } finally {
    await query(
      `UPDATE legal_sources SET provenance = 'synthetic', gazette_status = 'unverified', gazette_reference = NULL, gazette_verified_by = NULL, gazette_verified_at = NULL,
              is_synthetic = true, source_url = NULL WHERE id = $1`,
      [id]
    );
    resetLawTitleCache();
  }
});
