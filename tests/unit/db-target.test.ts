import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMayMutate, describeTarget, redactUrl } from "@/lib/db-target";

/**
 * Phase 2.4: a write is refused unless the target database is known not to be
 * production — or production is explicitly confirmed — and no credential is
 * ever printed.
 */

const NEON_PROD = "postgres://owner:s3cret-PROD@ep-prod-main-111111-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const NEON_BRANCH = "postgres://owner:s3cret-BRANCH@ep-branch-verify-222222.eu-central-1.aws.neon.tech/neondb?sslmode=require";

test("the environment comes from facts the operator controls, production first", () => {
  assert.equal(describeTarget("postgres://postgres:pw@localhost:5432/ailegal_test", {}).environment, "local");
  assert.equal(describeTarget(NEON_BRANCH, {}).environment, "unknown", "an undeclared remote database is unknown");
  assert.equal(describeTarget(NEON_BRANCH, { DATABASE_ENVIRONMENT: "branch" }).environment, "branch");
  const prodHost = "ep-prod-main-111111.eu-central-1.aws.neon.tech";
  // A production connection string declared as a branch is still production.
  const mislabelled = describeTarget(NEON_PROD, { DATABASE_ENVIRONMENT: "branch", PRODUCTION_DATABASE_HOST: prodHost });
  assert.equal(mislabelled.environment, "production", "the pooler host of a listed endpoint is the same endpoint");
  assert.equal(mislabelled.neonEndpoint, "ep-prod-main-111111");
  assert.equal(describeTarget(NEON_BRANCH, { DATABASE_ENVIRONMENT: "branch", PRODUCTION_DATABASE_HOST: prodHost }).environment, "branch");
  assert.equal(describeTarget("not a url", {}).environment, "unknown");
});

test("writes: local, branch and staging proceed; production needs --confirm-production; unknown is refused", () => {
  const what = { what: "db:migrate", confirmProduction: false };
  assertMayMutate(describeTarget("postgres://u:p@127.0.0.1/x", {}), what);
  assertMayMutate(describeTarget(NEON_BRANCH, { DATABASE_ENVIRONMENT: "staging" }), what);
  assert.throws(() => assertMayMutate(describeTarget(NEON_BRANCH, {}), what), /refused .*UNKNOWN/);
  const prod = describeTarget(NEON_PROD, { DATABASE_ENVIRONMENT: "production" });
  assert.throws(() => assertMayMutate(prod, what), /refused on PRODUCTION/);
  assertMayMutate(prod, { ...what, confirmProduction: true });
});

test("no credential is ever printed: not in the target, not in its errors, not in a redacted URL", () => {
  const t = describeTarget(NEON_PROD, { DATABASE_ENVIRONMENT: "production" });
  let message = "";
  try {
    assertMayMutate(t, { what: "x", confirmProduction: false });
  } catch (err) {
    message = (err as Error).message;
  }
  for (const s of [JSON.stringify(t), message, redactUrl(NEON_PROD), redactUrl("postgres://u:p@h/d?password=zzz")]) {
    assert.ok(!/s3cret|owner|zzz/.test(s), s);
  }
  assert.match(redactUrl(NEON_PROD), /ep-prod-main-111111-pooler/);
});
