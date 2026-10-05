import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useTestEnv, serviceCaller } from "./helpers";
import { getPool, query, queryOne } from "@/lib/db";
import { loadEvalFixtures } from "../../scripts/load-eval-fixtures";
import { hybridSearch, getChunksByIds } from "@/lib/search/hybrid";
import { extractLawReference, resetLawTitleCache, resolveLawReference } from "@/lib/search/law-reference";
import { verifyAndCleanCitations } from "@/lib/ai/citation-verify";
import { corpusVersion, resetVersionCaches } from "@/lib/ai/versioning";
import { runChatPipeline } from "@/lib/ai/pipelines/chat";
import { ingestSource } from "@/lib/ingest/pipeline";
import { authorityLevel, isServableSource, servableSourceSql, setGazetteStatus, setIntegrity } from "@/lib/corpus/integrity";
import { applyRepairs, loadRepairRows, servingBlockers, type RepairManifest } from "@/lib/corpus/repairs";
import { normalizeTitles } from "@/lib/corpus/maintenance";
import { runIntegrityCheck } from "@/lib/corpus/check";

/**
 * Corpus repair (2026-10) against the real schema: what must NEVER be served
 * — a garbled, quarantined, never-checked or replaced text, a source that is
 * not ready, a non-Jordanian source, a fixture outside evaluation, a
 * superseded text when the current one is asked for — by any route (search,
 * a client-supplied chunk id, law-title resolution, citation verification,
 * the corpus version); the Civil Code case (quarantined from the manifest,
 * kept, and answered "unavailable" by every route); Gazette verification
 * rules; the manifest against a database; and source classes in ranking.
 */
useTestEnv();

const ROOT = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "corpus-repair-test-"));
const created: number[] = [];
const A = () => serviceCaller("office-corpus-repair", "user-1");

before(async () => {
  await loadEvalFixtures({ quiet: true });
  resetLawTitleCache();
});
after(async () => {
  process.env.ALLOW_SYNTHETIC_CORPUS = "true";
  if (created.length) await query(`DELETE FROM legal_sources WHERE id = ANY($1::bigint[])`, [created]);
  rmSync(dir, { recursive: true, force: true });
  await getPool().end();
});

const garble = (t: string) =>
  [...t].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x0621 && c <= 0x064a ? String.fromCharCode(0x0621 + (((c - 0x0621) * 5 + 11) % 42)) : ch;
  }).join("");

/** A NON-synthetic source (as production rows are), ingested through the real pipeline — which checks it. */
async function ingest(
  title: string,
  text: string,
  opts: { sourceType?: string; lawNumber?: string | null; provenance?: string | null; synthetic?: boolean; note?: string | null } = {}
): Promise<number> {
  const synthetic = opts.synthetic ?? false;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO legal_sources (title, source_type, status, law_number, effective_date, is_current_version, jurisdiction, language, provenance, is_synthetic, note)
     VALUES ($1, $2, 'pending', $3, '2099-01-01', true, 'JO', 'ar', $4, $5, $6) RETURNING id`,
    [title, opts.sourceType ?? "law", opts.lawNumber ?? null, synthetic ? "synthetic" : (opts.provenance ?? null), synthetic, opts.note ?? null]
  );
  const id = Number(row!.id);
  created.push(id);
  const file = join(dir, `${id}.txt`);
  writeFileSync(file, text, "utf8");
  await ingestSource({ sourceId: id, filePath: file, title, sourceType: opts.sourceType ?? "law", court: null, year: null });
  return id;
}

const integrityOf = async (id: number) => (await queryOne<{ s: string }>(`SELECT integrity_status AS s FROM legal_sources WHERE id = $1`, [id]))!.s;
const chunkIdsOf = async (id: number) => (await query<{ id: string }>(`SELECT id FROM legal_documents WHERE source_id = $1 ORDER BY chunk_index`, [id])).map((r) => Number(r.id));
const fromSource = (chunks: { source_id: number | string }[], id: number) => chunks.some((c) => Number(c.source_id) === id);
const refresh = () => {
  resetLawTitleCache();
  resetVersionCaches();
};

const BEES_TITLE = "قانون تربية النحل التجريبي رقم 44 لسنة 2099";
const BEES =
  "المادة 1: يسمى هذا القانون قانون تربية النحل التجريبي لسنة 2099 ويعمل به من تاريخ نشره في الجريدة الرسمية.\n" +
  "المادة 2: يلتزم مربي النحل بتسجيل خلايا النحل لدى مديرية الثروة الحيوانية قبل نقلها، ويحظر نقل الخلايا خلال موسم الإزهار دون تصريح.\n" +
  "المادة 3: يعاقب كل من خالف أحكام المادة الثانية من هذا القانون بغرامة لا تقل عن خمسين ديناراً ولا تزيد على مئتي دينار.\n" +
  "المادة 4: تتولى المديرية الكشف على المناحل مرة في السنة على الأقل، ولها أن تأمر بإتلاف الخلايا المصابة بالأمراض الوبائية.";
const BEES_Q = "ما التزامات مربي النحل عند نقل خلايا النحل؟";

/** Every route by which a source's text could reach a lawyer. */
async function routes(id: number) {
  refresh();
  const search = await hybridSearch(BEES_Q);
  const byId = await getChunksByIds(await chunkIdsOf(id));
  const ref = extractLawReference("ما نص المادة 2 من قانون تربية النحل التجريبي؟")!;
  const title = await resolveLawReference(ref);
  const cite = await verifyAndCleanCitations("وفق المادة 2 من قانون تربية النحل التجريبي رقم 44 لسنة 2099");
  return {
    search: fromSource(search.chunks, id),
    byId: byId.length > 0,
    title: title.sourceIds.includes(id),
    citation: cite.verifiedCount > 0,
    version: await corpusVersion(),
  };
}

test("never served — garbled at ingest, quarantined, unchecked, replaced, not ready, non-Jordanian, a fixture outside evaluation, superseded for a current question", async () => {
  const id = await ingest(BEES_TITLE, BEES, { lawNumber: "44" });
  assert.equal(await integrityOf(id), "passed", "a sound text passes the ingest's check");
  const served = await routes(id);
  assert.deepEqual([served.search, served.byId, served.title, served.citation], [true, true, true, true], "control: every route reaches it while it is servable");

  const states: [string, string][] = [
    ["quarantined", `UPDATE legal_sources SET integrity_status = 'quarantined' WHERE id = $1`],
    ["unchecked", `UPDATE legal_sources SET integrity_status = 'unchecked' WHERE id = $1`],
    ["replaced", `UPDATE legal_sources SET integrity_status = 'replaced' WHERE id = $1`],
    ["not ready", `UPDATE legal_sources SET status = 'processing' WHERE id = $1`],
    ["non-Jordanian", `UPDATE legal_sources SET jurisdiction = 'EG' WHERE id = $1`],
    ["fixture outside evaluation", `UPDATE legal_sources SET is_synthetic = true, provenance = 'synthetic' WHERE id = $1`],
  ];
  for (const [state, sql] of states) {
    if (state === "fixture outside evaluation") process.env.ALLOW_SYNTHETIC_CORPUS = "false";
    await query(sql, [id]);
    try {
      const r = await routes(id);
      assert.deepEqual([r.search, r.byId, r.title, r.citation], [false, false, false, false], `${state}: no route serves it`);
      assert.notEqual(r.version, served.version, `${state}: answers trace to a different corpus version`);
    } finally {
      process.env.ALLOW_SYNTHETIC_CORPUS = "true";
      await query(
        `UPDATE legal_sources SET integrity_status = 'passed', status = 'ready', jurisdiction = 'JO', is_synthetic = false, provenance = NULL WHERE id = $1`,
        [id]
      );
    }
  }
  assert.equal((await routes(id)).search, true, "restored");

  // Superseded: never answers a question about the law in force.
  await query(`UPDATE legal_sources SET is_current_version = false WHERE id = $1`, [id]);
  try {
    refresh();
    assert.equal(fromSource((await hybridSearch(BEES_Q)).chunks, id), false, "a superseded text never answers a current question");
  } finally {
    await query(`UPDATE legal_sources SET is_current_version = true WHERE id = $1`, [id]);
  }

  // Garbled from the start: quarantined by the ingest itself, with its findings on record.
  const garbled = await ingest("قانون تربية الأغنام التجريبي رقم 45 لسنة 2099", garble(BEES.replace(/النحل/g, "الأغنام")).repeat(2), { lawNumber: "45" });
  assert.equal(await integrityOf(garbled), "quarantined");
  const event = await queryOne<{ actor: string; reason: string; kind: string }>(`SELECT actor, reason, kind FROM corpus_integrity_events WHERE source_id = $1`, [garbled]);
  assert.deepEqual([event!.actor, event!.kind], ["ingest (automatic)", "integrity"]);
  assert.match(event!.reason, /garbled_text/);
  refresh();
  assert.equal(fromSource((await hybridSearch(garble("يلتزم مربي الأغنام بتسجيل"))).chunks, garbled), false, "not even by its own garbled words");
});

test("the servable rule is one rule: the SQL condition and its in-memory twin agree on every state", async () => {
  const states: { status: string; jurisdiction: string; is_synthetic: boolean; integrity_status: string }[] = [];
  for (const status of ["ready", "processing", "failed"])
    for (const jurisdiction of ["JO", "EG"])
      for (const is_synthetic of [false, true])
        for (const integrity_status of ["unchecked", "passed", "quarantined", "replaced"]) states.push({ status, jurisdiction, is_synthetic, integrity_status });
  for (const allow of [false, true]) {
    const rows = await query<{ i: number; servable: boolean }>(
      `SELECT i, (${servableSourceSql("t", "$2")}) AS servable
         FROM jsonb_to_recordset($1::jsonb) AS t(i int, status text, jurisdiction text, is_synthetic boolean, integrity_status text)`,
      [JSON.stringify(states.map((s, i) => ({ i, ...s }))), allow]
    );
    for (const r of rows) assert.equal(r.servable, isServableSource(states[r.i], allow), `${JSON.stringify(states[r.i])} allow=${allow}`);
    assert.equal(rows.filter((r) => r.servable).length, allow ? 2 : 1, "only ready + JO + passed (+ fixture when allowed)");
  }
});

test("the Civil Code case: quarantined from the manifest, kept as evidence, and 'unavailable' by every route", async () => {
  const title = "القانون المدني التجريبي رقم 43 لسنة 2099";
  const text =
    "المادة 1: يسمى هذا القانون القانون المدني التجريبي لسنة 2099 ويعمل به من تاريخ نشره في الجريدة الرسمية.\n" +
    "المادة 2: العقد ارتباط الإيجاب الصادر من أحد المتعاقدين بقبول الآخر وتوافقهما على وجه يثبت أثره في المعقود عليه.\n" +
    "المادة 3: يلتزم البائع بتسليم المبيع إلى المشتري بالحالة التي كان عليها وقت البيع، ويضمن العيوب الخفية فيه.\n" +
    "المادة 4: يكون التعويض عن الضرر بقدر ما لحق المضرور من ضرر وما فاته من كسب بشرط أن يكون نتيجة طبيعية للفعل الضار.";
  const id = await ingest(title, text, { lawNumber: "43" });
  const manifest: RepairManifest = {
    repairs: [
      {
        id: "civil-test",
        action: "quarantine",
        match: { sourceId: id, titleIncludesAll: ["المدني"] },
        launchBlocker: true,
        reason: "character-corrupted (test)",
        evidence: "test",
      },
    ],
  };
  const chunksBefore = (await chunkIdsOf(id)).length;
  refresh();
  const ask = (question: string) => runChatPipeline({ question }, A());
  assert.equal((await ask("ما نص المادة 3 من القانون المدني التجريبي؟")).mode !== "law_unavailable", true, "control: served before the repair");

  const { rows, applied } = await loadRepairRows(getPool());
  assert.equal(servingBlockers(manifest, rows, applied).length, 1, "a launch blocker while servable");
  const dry = await applyRepairs({ apply: false, manifest });
  assert.deepEqual(dry.map((p) => p.outcome), ["apply"]);
  assert.equal(await integrityOf(id), "passed", "a dry run writes nothing");
  assert.deepEqual((await applyRepairs({ apply: true, manifest })).map((p) => p.outcome), ["applied"]);
  assert.deepEqual((await applyRepairs({ apply: true, manifest })).map((p) => p.outcome), ["already"], "idempotent");
  assert.equal(await integrityOf(id), "quarantined");
  const after = await loadRepairRows(getPool());
  assert.equal(servingBlockers(manifest, after.rows, after.applied).length, 0);

  refresh();
  // Retrieval: neither a question naming it nor one about its content reaches it.
  for (const q of ["ما نص المادة 3 من القانون المدني التجريبي؟", "ما التزامات البائع بتسليم المبيع وضمان العيوب الخفية في القانون المدني التجريبي؟"]) {
    const r = await ask(q);
    assert.equal(r.mode, "law_unavailable", `${q}: ${r.answer}`);
    assert.match(r.answer, /محجوب/);
    assert.match(r.answer, /الجريدة الرسمية/);
    assert.deepEqual(r.sources, [], "nothing of it is cited");
  }
  assert.equal(fromSource((await hybridSearch("يلتزم البائع بتسليم المبيع ويضمن العيوب الخفية")).chunks, id), false, "an unnamed question never reaches it");
  // Title search and current-version resolution.
  const lawRef = extractLawReference("القانون المدني التجريبي رقم 43 لسنة 2099")!;
  assert.deepEqual((await resolveLawReference(lawRef)).sourceIds, [], "title resolution does not offer it");
  const s = await hybridSearch("ما أحكام العقد في القانون المدني التجريبي؟");
  assert.ok(s.requestedLawHeldBack && s.requestedLawHeldBack.statuses.includes("quarantined"), JSON.stringify(s.requestedLawHeldBack));
  assert.deepEqual(s.chunks.filter((c) => Number(c.source_id) === id), []);
  // Citation lookup and client-supplied ids.
  assert.equal((await verifyAndCleanCitations("المادة 3 من القانون المدني التجريبي رقم 43 لسنة 2099")).verifiedCount, 0);
  assert.deepEqual(await getChunksByIds(await chunkIdsOf(id)), []);
  // Kept as evidence: the row, its text and the decision are all still there.
  assert.equal((await chunkIdsOf(id)).length, chunksBefore);
  const ev = await queryOne<{ kind: string; from_status: string; to_status: string; evidence: string }>(
    `SELECT kind, from_status, to_status, evidence FROM corpus_integrity_events WHERE source_id = $1 AND actor = 'repair-manifest:civil-test'`,
    [id]
  );
  assert.deepEqual([ev!.kind, ev!.from_status, ev!.to_status, ev!.evidence], ["integrity", "passed", "quarantined", "test"]);
  // The automatic check never brings it back.
  await runIntegrityCheck({ apply: true, recheck: true, sourceIds: [id] });
  assert.equal(await integrityOf(id), "quarantined");
});

test("Gazette verification: needs the reference and a passed text, never changes provenance; the database refuses a claim without evidence", async () => {
  const id = await ingest("قانون تنظيم الأسواق التجريبي رقم 46 لسنة 2099", BEES.replace(/تربية النحل/g, "تنظيم الأسواق"), { lawNumber: "46", provenance: "secondary" });
  const change = { actor: "integration-test", reason: "compared with the Gazette (test)" };
  await assert.rejects(setGazetteStatus(id, "verified", change), /evidence/);
  await setIntegrity(id, "quarantined", { ...change, reason: "suspect (test)" });
  await assert.rejects(setGazetteStatus(id, "verified", { ...change, evidence: "عدد 1 ص 2" }), /passed the integrity checks/);
  await setIntegrity(id, "passed", { ...change, reason: "reviewed (test)" });
  assert.deepEqual(await setGazetteStatus(id, "verified", { ...change, evidence: "الجريدة الرسمية عدد 9999 صفحة 12 (test)" }), { from: "unverified", to: "verified" });
  const row = await queryOne<{ provenance: string; gazette_status: string; gazette_reference: string; gazette_verified_by: string; integrity_status: string; is_synthetic: boolean }>(
    `SELECT provenance, gazette_status, gazette_reference, gazette_verified_by, integrity_status, is_synthetic FROM legal_sources WHERE id = $1`,
    [id]
  );
  assert.deepEqual([row!.provenance, row!.gazette_status, row!.gazette_verified_by], ["secondary", "verified", "integration-test"], "a secondary text stays secondary");
  assert.match(row!.gazette_reference, /9999/);
  assert.equal(authorityLevel(row!), "gazette_verified");
  const kinds = (await query<{ kind: string }>(`SELECT kind FROM corpus_integrity_events WHERE source_id = $1 ORDER BY id`, [id])).map((r) => r.kind);
  assert.deepEqual(kinds, ["integrity", "integrity", "integrity", "gazette"], "ingest check, quarantine, pass, Gazette");

  await assert.rejects(query(`UPDATE legal_sources SET gazette_reference = NULL WHERE id = $1`, [id]), /gazette_evidence_chk/, "the database refuses a verification without its reference");
  await assert.rejects(query(`UPDATE legal_sources SET integrity_status = 'verified' WHERE id = $1`, [id]), /integrity_chk/, "the Phase 2.1 value is gone");
  await setGazetteStatus(id, "unverified", { ...change, reason: "reference withdrawn (test)" });
  const cleared = await queryOne<{ gazette_reference: string | null }>(`SELECT gazette_reference FROM legal_sources WHERE id = $1`, [id]);
  assert.equal(cleared!.gazette_reference, null);
});

test("the manifest against a database: a wrong id changes nothing; a retitle reaches the citation label; a recorded provenance is kept", async () => {
  const rpText =
    "المادة 1: تسجل الأراضي والعقارات في السجل العقاري لدى دائرة الأراضي والمساحة.\n" +
    "المادة 2: لا ينتقل حق الملكية في العقار إلا بالتسجيل في السجل العقاري، ويقع باطلاً كل بيع لم يسجل.\n" +
    "المادة 3: يجوز رهن العقار رهناً تأمينياً ضماناً لدين، ويسجل الرهن في السجل العقاري.";
  const rp = await ingest("قانون الملكية العقارية التجريبي لسنة أحكام عامة", rpText);
  const mou = await ingest(
    "مذكرة تفاهم تجريبية بين وزارة العدل ودائرة الأراضي",
    "تتعاون وزارة العدل ودائرة الأراضي في تبادل بيانات السجل العقاري إلكترونياً، وتلتزم كل منهما بحماية سرية البيانات المتبادلة.",
    { sourceType: "instruction" }
  );
  const lob = await ingest("قانون التجارة التجريبي رقم 47 لسنة 2099", BEES.replace(/تربية النحل/g, "التجارة"), { lawNumber: "47", provenance: "official" });
  const manifest: RepairManifest = {
    repairs: [
      { id: "rp-title", action: "retitle", match: { titleEquals: "قانون الملكية العقارية التجريبي لسنة أحكام عامة" }, params: { title: "قانون الملكية العقارية التجريبي" }, reason: "r", evidence: "e" },
      { id: "wrong-id", action: "quarantine", match: { sourceId: rp, titleIncludesAll: ["المدني"] }, reason: "r", evidence: "e" },
      { id: "mou-type", action: "reclassify", match: { titleStartsWith: "مذكرة تفاهم تجريبية", sourceType: ["instruction"] }, params: { sourceType: "mou" }, reason: "r", evidence: "e" },
      { id: "keep-provenance", action: "set_provenance", match: { sourceId: lob, titleIncludesAll: ["التجارة"] }, params: { provenance: "secondary" }, reason: "r", evidence: "e" },
    ],
  };
  const lawNameBefore = (await queryOne<{ n: string }>(`SELECT law_name AS n FROM legal_documents WHERE source_id = $1 LIMIT 1`, [rp]))!.n;
  assert.equal(lawNameBefore, "قانون الملكية العقارية التجريبي لسنة أحكام عامة", "the damaged title labels every citation card");

  const first = await applyRepairs({ apply: true, manifest });
  assert.deepEqual(first.map((p) => `${p.id}:${p.outcome}`), ["rp-title:applied", "wrong-id:mismatch", "mou-type:applied", "keep-provenance:conflict"]);
  const rpRow = await queryOne<{ title: string; integrity_status: string; law_number: string | null }>(`SELECT title, integrity_status, law_number FROM legal_sources WHERE id = $1`, [rp]);
  assert.deepEqual([rpRow!.title, rpRow!.integrity_status, rpRow!.law_number], ["قانون الملكية العقارية التجريبي", "passed", null], "renamed, not quarantined by a wrong id, no number invented");
  const names = await query<{ n: string }>(`SELECT DISTINCT law_name AS n FROM legal_documents WHERE source_id = $1`, [rp]);
  assert.deepEqual(names.map((r) => r.n), ["قانون الملكية العقارية التجريبي"], "the citation label follows");
  assert.equal((await queryOne<{ t: string }>(`SELECT source_type AS t FROM legal_sources WHERE id = $1`, [mou]))!.t, "mou");
  assert.equal((await queryOne<{ p: string }>(`SELECT provenance AS p FROM legal_sources WHERE id = $1`, [lob]))!.p, "official", "never overwritten");
  const ev = await query<{ kind: string; from_status: string; to_status: string }>(
    `SELECT kind, from_status, to_status FROM corpus_integrity_events WHERE actor LIKE 'repair-manifest:%' AND source_id = ANY($1::bigint[]) ORDER BY id`,
    [[rp, mou, lob]]
  );
  assert.deepEqual(ev.map((e) => `${e.kind}:${e.from_status}>${e.to_status}`), [
    "metadata:قانون الملكية العقارية التجريبي لسنة أحكام عامة>قانون الملكية العقارية التجريبي",
    "classification:instruction>mou",
  ]);
  const second = await applyRepairs({ apply: true, manifest });
  assert.deepEqual(second.map((p) => `${p.id}:${p.outcome}`), ["rp-title:already", "wrong-id:mismatch", "mou-type:already", "keep-provenance:conflict"]);
});

test("normalize-titles: tatweel and digit forms go, the hidden law number is read from the title, nothing is invented", async () => {
  // A plausible year: normalize-titles never takes an impossible one (2099) as a law's year.
  const id = await ingest("قانـــون الحرف التجريبي رقـم ٤٨ لسنـــة ٢٠١٩", BEES.replace(/تربية النحل/g, "الحرف"));
  const bare = await ingest("قانـون المهن التجريبي", BEES.replace(/تربية النحل/g, "المهن"));
  const plan = await normalizeTitles(false);
  const mine = plan.filter((f) => f.sourceId === id || f.sourceId === bare);
  assert.deepEqual(
    mine.map((f) => [f.to, f.lawNumber]),
    [
      ["قانون الحرف التجريبي رقم 48 لسنة 2019", "48"],
      ["قانون المهن التجريبي", null],
    ]
  );
  await normalizeTitles(true);
  const row = await queryOne<{ title: string; law_number: string; year: number }>(`SELECT title, law_number, year FROM legal_sources WHERE id = $1`, [id]);
  assert.deepEqual([row!.title, row!.law_number, Number(row!.year)], ["قانون الحرف التجريبي رقم 48 لسنة 2019", "48", 2019]);
  const b = await queryOne<{ law_number: string | null; year: number | null }>(`SELECT law_number, year FROM legal_sources WHERE id = $1`, [bare]);
  assert.deepEqual([b!.law_number, b!.year], [null, null], "a title without a number gets none");
  const meta = await query<{ to_status: string }>(`SELECT to_status FROM corpus_integrity_events WHERE source_id = $1 AND kind = 'metadata' ORDER BY id`, [id]);
  assert.deepEqual(meta.map((m) => m.to_status), ["قانون الحرف التجريبي رقم 48 لسنة 2019", "law_number=48", "year=2019"]);
});

test("source classes in live search: an admitted law article outranks a memorandum that matches the question's words more closely", async () => {
  const law = await ingest(
    "قانون النقل العام التجريبي رقم 49 لسنة 2099",
    "المادة 1: يسمى هذا القانون قانون النقل العام التجريبي لسنة 2099.\n" +
      "المادة 2: لا يجوز تشغيل أي مركبة نقل عام إلا بعد الحصول على ترخيص من هيئة تنظيم النقل، ويجدد الترخيص سنوياً بشرط اجتياز الفحص الفني للمركبة.",
    { lawNumber: "49" }
  );
  const mou = await ingest(
    "مذكرة تفاهم تجريبية حول ترخيص مركبات النقل العام",
    "مذكرة تفاهم حول ترخيص مركبات النقل العام: تتعاون الهيئة والوزارة في ترخيص مركبات النقل العام وتجديد ترخيص مركبات النقل العام وتبادل بيانات ترخيص مركبات النقل العام.",
    { sourceType: "mou" }
  );
  refresh();
  const r = await hybridSearch("ما شروط ترخيص مركبات النقل العام وتجديد الترخيص؟");
  const pos = (id: number) => r.chunks.findIndex((c) => Number(c.source_id) === id);
  assert.ok(pos(law) >= 0 && pos(mou) >= 0, `both are admitted: ${JSON.stringify(r.chunks.map((c) => c.source_title))}`);
  assert.ok(r.chunks[pos(mou)].score > r.chunks[pos(law)].score, `the memorandum scored higher (${r.chunks[pos(mou)].score} vs ${r.chunks[pos(law)].score}) — so the order below is the class rule, not the score`);
  assert.ok(pos(law) < pos(mou), "legislation first, whatever the lexical similarity");
  // Asked about the memorandum itself: it is not held under the law.
  const asked = await hybridSearch("ما الذي تنص عليه مذكرة التفاهم حول ترخيص مركبات النقل العام؟");
  const p = (id: number) => asked.chunks.findIndex((c) => Number(c.source_id) === id);
  assert.ok(p(mou) >= 0 && (p(law) < 0 || p(mou) < p(law)), JSON.stringify(asked.chunks.map((c) => c.source_title)));
  const c = (await runChatPipeline({ question: "ما شروط ترخيص مركبات النقل العام في قانون النقل العام التجريبي؟" }, A())).sources;
  assert.ok(c.length > 0 && c.every((s) => s.sourceClass === "legislation"), JSON.stringify(c.map((s) => [s.title, s.sourceClass])));
});

test("migration: a Phase 2.1 'verified' text becomes integrity passed — never Gazette-verified — and the change is logged", async () => {
  const id = await ingest("قانون الأوزان التجريبي رقم 50 لسنة 2099", BEES.replace(/تربية النحل/g, "الأوزان"), { lawNumber: "50", provenance: "official" });
  // Recreate the Phase 2.1 state: its CHECK, and a row it marked 'verified'.
  await query(`ALTER TABLE legal_sources DROP CONSTRAINT legal_sources_integrity_chk`);
  await query(
    `ALTER TABLE legal_sources ADD CONSTRAINT legal_sources_integrity_status_check
       CHECK (integrity_status IN ('verified', 'unverified', 'quarantined', 'replaced', 'unchecked', 'passed'))`
  );
  await query(`UPDATE legal_sources SET integrity_status = 'verified', integrity_note = 'compared with the Legislation Bureau copy (test)' WHERE id = $1`, [id]);
  await getPool().query(readFileSync(resolve(ROOT, "db/schema.sql"), "utf8"));

  const row = await queryOne<{ integrity_status: string; gazette_status: string; gazette_reference: string | null; provenance: string }>(
    `SELECT integrity_status, gazette_status, gazette_reference, provenance FROM legal_sources WHERE id = $1`,
    [id]
  );
  assert.deepEqual([row!.integrity_status, row!.gazette_status, row!.gazette_reference, row!.provenance], ["passed", "unverified", null, "official"]);
  const ev = await queryOne<{ from_status: string; to_status: string; actor: string; evidence: string; reason: string }>(
    `SELECT from_status, to_status, actor, evidence, reason FROM corpus_integrity_events WHERE source_id = $1 AND actor LIKE 'migration%'`,
    [id]
  );
  assert.deepEqual([ev!.from_status, ev!.to_status, ev!.evidence], ["verified", "passed", "compared with the Legislation Bureau copy (test)"]);
  assert.match(ev!.reason, /NOT inferred/);
  const constraints = (await query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = 'legal_sources'::regclass AND contype = 'c'`)).map((c) => c.conname);
  assert.ok(constraints.includes("legal_sources_integrity_chk") && !constraints.includes("legal_sources_integrity_status_check"), constraints.join(", "));
});
