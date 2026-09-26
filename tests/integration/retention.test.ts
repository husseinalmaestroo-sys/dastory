import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { useTestEnv, findInDatabase } from "./helpers";
import { getPool, query, queryOne } from "@/lib/db";
import { purgeExpiredContent, deleteSessionContent, deleteOfficeAccounting } from "@/lib/retention";
import { hybridSearch } from "@/lib/search/hybrid";
import { loadEvalFixtures } from "../../scripts/load-eval-fixtures";

useTestEnv();
process.env.STORAGE_DIR = "./storage-test";

before(async () => {
  await loadEvalFixtures({ quiet: true });
});
after(async () => {
  await getPool().end();
});

test("retention: standalone content older than the window is deleted — rows AND stored files", async () => {
  const dir = resolve(process.cwd(), "storage-test", "cases", "2000-01");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "old-case.pdf");
  writeFileSync(file, "%PDF- CANARY-RET-OLD");
  await query(
    `INSERT INTO uploaded_cases (session_id, file_name, file_path, extracted_text, status, created_at)
     VALUES ('sess-old', 'x.pdf', $1, 'CANARY-RET-OLD', 'ready', now() - interval '400 days')`,
    [file]
  );
  await query(`INSERT INTO chat_history (session_id, question, answer, created_at) VALUES ('sess-old', 'CANARY-RET-OLD', 'a', now() - interval '400 days')`);
  await query(`INSERT INTO chat_history (session_id, question, answer) VALUES ('sess-new', 'CANARY-RET-NEW', 'a')`);

  const r = await purgeExpiredContent(90);
  assert.ok(r.uploadedCases >= 1 && r.chatHistory >= 1);
  assert.equal(existsSync(file), false, "the stored PDF is deleted with its row");
  assert.deepEqual(await findInDatabase("CANARY-RET-OLD"), []);
  assert.equal((await findInDatabase("CANARY-RET-NEW")).length, 1, "recent content is kept");

  const d = await deleteSessionContent("sess-new");
  assert.equal(d.chatHistory, 1);
  assert.deepEqual(await findInDatabase("CANARY-RET-NEW"), [], "a session's deletion request removes all its content");
});

test("office offboarding removes the office's accounting rows", async () => {
  await query(`INSERT INTO ai_requests (request_id, caller_kind, office_id, user_id, feature, success) VALUES ('r-off', 'service', 'office-GONE', 'u', 'chat', true)`);
  assert.equal(await deleteOfficeAccounting("office-GONE"), 1);
  assert.equal((await query(`SELECT 1 FROM ai_requests WHERE office_id = 'office-GONE'`)).length, 0);
});

test("deleting a legal source removes its chunks and embeddings, and retrieval can no longer return it", async () => {
  const src = await queryOne<{ id: string }>(`SELECT id FROM legal_sources WHERE title = 'قانون الشركات التجريبي رقم 11 لسنة 2099'`);
  assert.ok(src);
  const before = await hybridSearch("رأس مال الشركة ذات المسؤولية المحدودة في قانون الشركات التجريبي");
  assert.ok(before.chunks.some((c) => Number(c.source_id) === Number(src!.id)));
  await query(`DELETE FROM legal_sources WHERE id = $1`, [src!.id]);
  const chunks = await query(`SELECT 1 FROM legal_documents WHERE source_id = $1`, [src!.id]);
  assert.equal(chunks.length, 0, "chunks + vectors cascade-deleted");
  const afterSearch = await hybridSearch("رأس مال الشركة ذات المسؤولية المحدودة في قانون الشركات التجريبي");
  assert.ok(!afterSearch.chunks.some((c) => Number(c.source_id) === Number(src!.id)));
  // Restore for other suites.
  await loadEvalFixtures({ quiet: true });
});
