/**
 * The database connection, by transport (Phase 2.4). Shared by the app pool
 * (db.ts) and the CLI scripts — no `server-only` import (db:migrate runs under
 * plain tsx).
 *
 *   DATABASE_TRANSPORT=tcp             (default) node-postgres, the Postgres
 *                                      protocol on port 5432
 *   DATABASE_TRANSPORT=neon-websocket  the same Postgres protocol carried over
 *                                      a WebSocket on port 443 by Neon's own
 *                                      serverless driver — for hosts whose
 *                                      network filters 5432 (the cloud
 *                                      environment this was written in). It
 *                                      goes through HTTPS_PROXY when one is
 *                                      set (NO_PROXY honoured), never around it.
 *
 * Both return a node-postgres-compatible Pool: query, connect/release and
 * transactions behave the same. NEON_WS_PROXY=<host:port/path> points the
 * driver at a local WebSocket→TCP bridge (scripts/ws-bridge.ts) — tests only:
 * plain ws://, no TLS.
 */
import { Pool as PgPool, type PoolConfig } from "pg";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import HttpsProxyAgent from "https-proxy-agent";
import type { Agent } from "node:http";
import { poolConfig } from "./pg-ssl";
import { bypassesProxy, httpsProxy } from "./net/proxy-env";

export type DbTransport = "tcp" | "neon-websocket";

export function dbTransport(env: Readonly<Record<string, string | undefined>> = process.env): DbTransport {
  const t = (env.DATABASE_TRANSPORT ?? "tcp").trim();
  if (t === "tcp" || t === "neon-websocket") return t;
  throw new Error(`DATABASE_TRANSPORT must be "tcp" or "neon-websocket", not "${t}".`);
}

let neonReady = false;
function configureNeon(): void {
  if (neonReady) return;
  neonReady = true;
  const bridge = process.env.NEON_WS_PROXY;
  if (bridge) {
    // Local bridge (tests): plain WebSocket, the Postgres protocol unencrypted
    // inside, exactly as Neon's own local-proxy instructions describe.
    neonConfig.wsProxy = (host, port) => `${bridge}?address=${host}:${port}`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    neonConfig.webSocketConstructor = WebSocket;
    return;
  }
  const proxy = httpsProxy();
  neonConfig.webSocketConstructor = proxy
    ? (class ProxiedWebSocket extends WebSocket {
        constructor(address: string | URL, protocols?: string | string[]) {
          const host = new URL(String(address)).hostname;
          const agent = bypassesProxy(host) ? undefined : (new (HttpsProxyAgent as unknown as new (url: string) => Agent)(proxy as string) as Agent);
          super(address, protocols, agent ? { agent } : {});
        }
      } as unknown as typeof WebSocket)
    : WebSocket;
}

/** A Pool for `url` over the configured transport. Options other than the connection string and TLS pass through. */
export function createPool(url: string, opts: Omit<PoolConfig, "connectionString" | "ssl"> = {}): PgPool {
  if (dbTransport() === "tcp") return new PgPool({ ...poolConfig(url), ...opts });
  configureNeon();
  return new NeonPool({ connectionString: url, ...opts }) as unknown as PgPool;
}
