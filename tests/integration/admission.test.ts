import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { useTestEnv, serviceCaller } from "./helpers";
import { getPool, query } from "@/lib/db";
import { admit } from "@/lib/ai/request";
import { LIMITS } from "@/lib/ratelimit";

/**
 * Admission is keyed per office (spend) and per office user (rate), not per
 * connection: every Dostoori request arrives from the same server IP, so the
 * old IP keys put all offices in one bucket — one busy office exhausted the
 * daily cost cap and the daily question limit for all of them.
 */
useTestEnv();

const run = randomBytes(4).toString("hex");
const officeA = `adm-A-${run}`;
const officeB = `adm-B-${run}`;

const cleanup = async (pattern: string) => {
  await query(`DELETE FROM cost_ledger WHERE cost_key LIKE $1`, [`office:adm-%${pattern}`]);
  await query(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE $1`, [`%:adm-%${pattern}%`]);
};

// Leftovers of an interrupted earlier run would count toward today's
// site-wide cap; remove them first, and this run's rows at the end.
before(() => cleanup(""));
after(async () => {
  await cleanup(`-${run}`);
  await getPool().end();
});

test("an office at its daily spend cap is refused; another office is not", async () => {
  const a = serviceCaller(officeA, "u1");
  await query(
    `INSERT INTO cost_ledger (cost_key, day, usd) VALUES ($1, current_date, $2)
     ON CONFLICT (cost_key, day) DO UPDATE SET usd = EXCLUDED.usd`,
    [a.costKey, a.costCapUsd]
  );
  assert.equal((await admit(a, "chat"))?.status, 429);
  assert.equal(await admit(serviceCaller(officeA, "u2"), "chat").then((r) => r?.status), 429, "the cap is the office's, whoever asks");
  assert.equal(await admit(serviceCaller(officeB, "u1"), "chat"), null);
});

test("a user at the burst limit is refused; a colleague in the same office is not", async () => {
  const u1 = () => serviceCaller(officeB, "burst-u1");
  for (let i = 1; i <= LIMITS.chat.limit; i++) assert.equal(await admit(u1(), "chat"), null, `request ${i}`);
  assert.equal((await admit(u1(), "chat"))?.status, 429);
  assert.equal(await admit(serviceCaller(officeB, "burst-u2"), "chat"), null);
});
