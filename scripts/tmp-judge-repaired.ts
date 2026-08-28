import "dotenv/config";
import { Pool } from "pg";
import { poolConfig } from "../src/lib/pg-ssl";
(async () => {
  const pool = new Pool(poolConfig(process.env.DATABASE_URL!));
  const { rows } = await pool.query(`
    SELECT id, question, verification_severity, verification_action, verification_repaired, mode
      FROM chat_history
     WHERE verification_severity IS NOT NULL
     ORDER BY id
  `);
  for (const r of rows)
    console.log(r.id, "|", r.verification_severity, "|", r.verification_action, "| repaired=" + r.verification_repaired, "|", r.question.slice(0, 50));
  await pool.end();
})();
