import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useTestEnv, serviceCaller } from "./helpers";
import { getPool } from "@/lib/db";
import { loadEvalFixtures } from "../../scripts/load-eval-fixtures";
import { runChatPipeline, SEMANTIC_UNVERIFIED_NOTICE } from "@/lib/ai/pipelines/chat";
import { resetLawTitleCache } from "@/lib/search/law-reference";
import { testProviderHooks } from "@/lib/ai/test-provider";
import { CONDITION_LABEL } from "@/lib/ai/grounding";
import type { ChatMessage, ChatOptions } from "@/lib/ai";

/**
 * Phase 2.1: the semantic judge's per-claim verdicts decide the answer end to
 * end — through the real chat pipeline, not just applyClaimVerdicts. The
 * stand-in judge returns SUPPORTED for every claim unless a test injects a
 * verdict through testProviderHooks.respond.
 */
useTestEnv();

before(async () => {
  await loadEvalFixtures({ quiet: true });
  resetLawTitleCache();
});
afterEach(() => {
  testProviderHooks.respond = null;
  testProviderHooks.onChat = null;
});
after(async () => {
  await new Promise((r) => setTimeout(r, 200)); // fire-and-forget error_log writes
  await getPool().end();
});

const QUESTION = "ما مدة الإجازة السنوية للعامل في قانون العمل التجريبي؟";
const A = () => serviceCaller("office-verdicts", "user-1");

/** A judge that rules on each numbered claim with `verdictFor(n)` (null: leaves it unjudged). */
function judgeWith(verdictFor: (n: number) => string | null) {
  testProviderHooks.respond = (messages: ChatMessage[], opts: ChatOptions) => {
    if (!String(opts.purpose ?? "").startsWith("judge")) return undefined;
    const user = messages.map((m) => m.content).join("\n");
    const ns = [...user.matchAll(/^(\d+)\)/gm)].map((m) => Number(m[1]));
    const claims = ns.flatMap((n) => {
      const v = verdictFor(n);
      return v ? [{ n, verdict: v }] : [];
    });
    return JSON.stringify({ issues: [], claims, notes: "" });
  };
}

test("control: every claim SUPPORTED — the answer is fully grounded, no notice", async () => {
  const r = await runChatPipeline({ question: QUESTION }, A());
  assert.equal(r.groundingLevel, "full", r.answer);
  assert.ok(!r.notices.includes(SEMANTIC_UNVERIFIED_NOTICE));
});

test("a claim the judge rules CONTRADICTED is removed from the answer; the rest stands", async () => {
  judgeWith((n) => (n === 1 ? "CONTRADICTED" : "SUPPORTED"));
  const r = await runChatPipeline({ question: QUESTION }, A());
  const removed = r.claims.filter((c) => c.status === "removed");
  assert.equal(removed.length, 1, JSON.stringify(r.claims));
  assert.ok(removed[0].issues.includes("semantic_contradiction"));
  assert.ok(!r.answer.includes(removed[0].text.slice(0, 40)), "the contradicted sentence is not in the answer");
  assert.ok(r.claims.some((c) => c.status === "supported"), "the supported claim stands");
});

test("UNSUPPORTED and IRRELEVANT verdicts remove claims; with none left, the sources are shown instead", async () => {
  judgeWith((n) => (n === 1 ? "UNSUPPORTED" : "IRRELEVANT"));
  const r = await runChatPipeline({ question: QUESTION }, A());
  assert.ok(["sources_only", "partial"].includes(r.mode), `${r.mode}: ${r.answer}`);
  if (r.mode === "partial") {
    assert.ok(r.claims.filter((c) => c.status !== "removed" && c.kind !== "limitation").length > 0);
  } else {
    assert.equal(r.grounded, false);
  }
});

test("a PARTIAL verdict labels the claim with its conditions instead of passing it", async () => {
  judgeWith((n) => (n === 1 ? "PARTIAL" : "SUPPORTED"));
  const r = await runChatPipeline({ question: QUESTION }, A());
  const q = r.claims.find((c) => c.status === "qualified");
  assert.ok(q, JSON.stringify(r.claims));
  assert.ok(q!.issues.includes("missing_condition"));
  assert.ok(r.answer.includes(CONDITION_LABEL.trim()), r.answer);
});

test("a judge that leaves a claim unjudged cannot make the answer 'full'", async () => {
  judgeWith((n) => (n === 1 ? "SUPPORTED" : null));
  const r = await runChatPipeline({ question: QUESTION }, A());
  assert.notEqual(r.groundingLevel, "full", r.answer);
  assert.ok(r.notices.includes(SEMANTIC_UNVERIFIED_NOTICE), JSON.stringify(r.notices));
});

test("a judge that is unavailable cannot make the answer 'full' either", async () => {
  testProviderHooks.onChat = (_m, opts) => {
    if (String(opts.purpose ?? "").startsWith("judge")) throw new Error("judge down (test)");
  };
  const r = await runChatPipeline({ question: QUESTION }, A());
  assert.notEqual(r.groundingLevel, "full");
  assert.ok(r.notices.includes(SEMANTIC_UNVERIFIED_NOTICE));
  assert.equal(r.verification?.status, "unavailable");
});
