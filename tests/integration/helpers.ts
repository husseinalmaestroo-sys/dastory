import type { Caller } from "@/lib/caller";
import { query } from "@/lib/db";

/**
 * Integration-test environment: a real Postgres+pgvector (DATABASE_URL), the
 * deterministic offline providers, and the synthetic corpus. Set before any
 * engine module reads env (env getters read process.env lazily).
 */
export function useTestEnv(): void {
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ailegal_test";
  process.env.CHAT_PROVIDER = "test";
  process.env.EMBEDDING_PROVIDER = "test";
  process.env.ALLOW_SYNTHETIC_CORPUS = "true";
  process.env.SELF_VERIFICATION ??= "true";
  process.env.QUERY_LLM_FALLBACK = "false";
  // Tests that need the automatic purge force it (retention.test.ts); left on,
  // it could delete rows a test seeded as "old" before the test looks at them.
  process.env.AUTO_RETENTION ??= "false";
}

export function serviceCaller(officeId: string, userId: string, requestId = `req-${officeId}-${userId}-${Math.random().toString(36).slice(2, 10)}`): Caller {
  return {
    kind: "service",
    principal: { kind: "service", officeId, userId, requestId },
    rateKey: `svc:${officeId}:${userId}`,
    costKey: `office:${officeId}`,
    costCapUsd: 5,
    retainContent: false,
    ipKey: null,
  };
}

/**
 * Every row of every text-bearing column in the public schema that contains
 * `needle` — the "is this tenant's content stored anywhere?" scan.
 */
export async function findInDatabase(needle: string): Promise<{ table: string; column: string; count: number }[]> {
  const cols = await query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`
  );
  const hits: { table: string; column: string; count: number }[] = [];
  for (const { table_name, column_name } of cols) {
    const rows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE '%' || $1 || '%'`,
      [needle]
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) hits.push({ table: table_name, column: column_name, count: n });
  }
  return hits;
}
