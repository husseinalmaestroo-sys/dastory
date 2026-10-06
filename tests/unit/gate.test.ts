import { test } from "node:test";
import assert from "node:assert/strict";
import { gateRow } from "../../src/lib/eval/gate";

test("a measured value passes only inside its threshold", () => {
  assert.equal(gateRow("g", 0, { max: 0 }, true).pass, true);
  assert.equal(gateRow("g", 3, { max: 0 }, true).pass, false);
  assert.equal(gateRow("g", 0.9, { min: 0.85 }, true).pass, true);
  assert.equal(gateRow("g", 0.8, { min: 0.85 }, true).pass, false);
  assert.equal(gateRow("g", 0.8, { min: 0.85 }, true).threshold, "≥ 0.85");
});

test("a missing value fails a binding gate when nothing explains it", () => {
  const row = gateRow("retrieval_mrr", null, { min: 0.7 }, true);
  assert.equal(row.pass, false);
  assert.equal(row.binding, true);
  assert.equal(row.notMeasured, undefined);
});

test("a missing value with a reason is NOT MEASURED and binds nothing (the live retrieval gates)", () => {
  const row = gateRow("retrieval_recall_at_8", null, { min: 0.85 }, true, "no retrieval case in this mode");
  assert.equal(row.binding, false);
  assert.equal(row.pass, false);
  assert.equal(row.notMeasured, "no retrieval case in this mode");
});

test("a reason never excuses a measured value", () => {
  const row = gateRow("retrieval_recall_at_8", 0.5, { min: 0.85 }, true, "no retrieval case in this mode");
  assert.equal(row.binding, true);
  assert.equal(row.pass, false);
  assert.equal(row.notMeasured, undefined);
});
