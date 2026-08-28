import "dotenv/config";
import { query } from "@/lib/db";

async function main() {
  const rows = await query(
    `SELECT bucket_key, count, reset_at, now() as server_now FROM rate_limit_buckets WHERE bucket_key LIKE 'lawyer-%' ORDER BY reset_at DESC`
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main();
