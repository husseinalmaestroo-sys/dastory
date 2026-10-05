import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { env } from "./env";
import { createPool } from "./db-pool";

// One pool per process, created on first query rather than at import.
//
// Two reasons it is lazy: `next build` imports every route module, and an
// eager pool would both demand DATABASE_URL at build time and open sockets
// from the build step. The global cache is for dev — hot reload re-evaluates
// modules, and without it every edit would leak a pool until Postgres runs
// out of connection slots.
const globalForDb = globalThis as unknown as { _pgPool?: Pool };

export function getPool(): Pool {
  if (globalForDb._pgPool) return globalForDb._pgPool;

  // Phase 2.4: over the configured transport (db-pool.ts) — TCP by default,
  // or Neon's WebSocket transport where port 5432 is filtered.
  const pool = createPool(env.databaseUrl, {
    // Postgres is Neon (managed, remote — eu-central-1), not co-located with
    // the app's Hostinger VPS, so this has nothing to do with sharing a box's
    // RAM. What it actually bounds is concurrent connections against Neon's
    // own limit (plan-dependent) and, per request, hybridSearch now only ever
    // holds one connection at a time (ARMS_SQL then FULL_ROW_SQL run
    // sequentially, not concurrently — see search/hybrid.ts), so 10 gives
    // comfortable headroom for concurrent *requests*, not a tight ceiling
    // hit by any single one.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // An 'error' listener is mandatory: pg emits this on idle clients when the
  // DB restarts or a firewall drops the socket, and an unhandled 'error' event
  // takes down the whole Node process.
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));

  globalForDb._pgPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** pgvector's text input format. `[1,2,3]` — not JSON, no spaces. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
