import { test, after } from "node:test";
import assert from "node:assert/strict";
import { useTestEnv } from "./helpers";
import { getPool } from "@/lib/db";
import { verifyAnswer } from "@/lib/ai/self-verify";
import { testProviderHooks } from "@/lib/ai/test-provider";
import { chunk } from "../unit/fixtures";

/**
 * The self-verification judge used to fail OPEN: an API error, a timeout or
 * an unparseable verdict was reported as "passed". It must now say that the
 * answer was not checked. (Integration, not unit: the failure path writes to
 * error_log.)
 */
useTestEnv();

after(async () => {
  testProviderHooks.onChat = null;
  // logError's error_log insert is fire-and-forget; let it land before the pool closes.
  await new Promise((r) => setTimeout(r, 200));
  await getPool().end();
});

const params = {
  question: "ما مدة الإشعار لفسخ الإيجار؟",
  chunks: [chunk()],
  answer: "يلتزم المؤجر بتسليم المأجور إلى المستأجر في الموعد المتفق عليه [1].",
  citationCheck: { verifiedCount: 0, redactedCount: 0 },
  isRepairAttempt: false,
};

test("a judge that runs reports ok", async () => {
  testProviderHooks.onChat = null;
  const r = await verifyAnswer(params);
  assert.equal(r.status, "ok");
});

test("a judge that fails is reported as unavailable — never as passed", async () => {
  testProviderHooks.onChat = (_messages, opts) => {
    if (String(opts.purpose ?? "").startsWith("judge")) throw new Error("judge unavailable (test)");
  };
  const r = await verifyAnswer(params);
  assert.equal(r.status, "unavailable");
  assert.equal(r.passed, false);
});
