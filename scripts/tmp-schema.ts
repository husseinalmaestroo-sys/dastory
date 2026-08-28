/** Prints the legal_sources columns and any views, to check assumptions. */
import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";

async function main() {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'legal_sources' ORDER BY ordinal_position`
  );
  console.log("legal_sources:", rows.map((r) => r.column_name).join(", "));

  const { rows: docs } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'legal_documents' ORDER BY ordinal_position`
  );
  console.log("legal_documents:", docs.map((r) => r.column_name).join(", "));

  const { rows: views } = await pool.query(
    `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`
  );
  console.log("views:", views.map((r) => r.table_name).join(", ") || "(none)");
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
