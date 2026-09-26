/**
 * Deletes standalone-app content older than CONTENT_RETENTION_DAYS (default
 * 90) and content-free accounting older than 400 days. Run daily (cron):
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/purge-content.ts
 *
 * Office offboarding (Dostoori): --office <officeId> removes that office's
 * accounting rows — the only per-office data this service keeps.
 */
import "dotenv/config";
import { getPool } from "../src/lib/db";
import { deleteOfficeAccounting, purgeExpiredContent } from "../src/lib/retention";

async function main() {
  const i = process.argv.indexOf("--office");
  if (i !== -1) {
    const office = process.argv[i + 1];
    if (!office) throw new Error("--office needs an office id");
    console.log(`deleted ${await deleteOfficeAccounting(office)} accounting row(s) for office ${office}`);
  } else {
    console.log(JSON.stringify(await purgeExpiredContent()));
  }
  await getPool().end();
}

main().catch((err) => {
  console.error("purge failed:", err);
  process.exit(1);
});
