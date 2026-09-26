import { test } from "node:test";
import assert from "node:assert/strict";
import { redactCitations } from "@/lib/ai/guard";

test("harness resolves @/ aliases and the server-only stub", () => {
  assert.equal(redactCitations("المادة 780 من القانون").redactedCount, 1);
});
