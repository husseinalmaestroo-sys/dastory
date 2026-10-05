/**
 * A local WebSocket→TCP bridge that stands in for Neon's WebSocket proxy, so
 * the neon-websocket transport (src/lib/db-pool.ts) can be tested end to end
 * against a local Postgres. Test tool only: plain ws://, loopback only.
 *
 *   npx tsx scripts/ws-bridge.ts [port]      # default 8089
 *   DATABASE_TRANSPORT=neon-websocket NEON_WS_PROXY=127.0.0.1:8089/v1 npm run test:integration
 *
 * Each WebSocket connection carries one Postgres session: the client names
 * its target as ?address=host:port; only loopback targets are accepted.
 */
import { createConnection } from "node:net";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8089);
const wss = new WebSocketServer({ host: "127.0.0.1", port });
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

wss.on("connection", (ws, req) => {
  const address = new URL(req.url ?? "/", "ws://bridge").searchParams.get("address") ?? "";
  const [host, p] = address.split(":");
  if (!LOOPBACK.has(host)) {
    ws.close(1008, "loopback targets only");
    return;
  }
  const socket = createConnection({ host, port: Number(p || 5432) });
  ws.on("message", (data) => socket.write(data as Buffer));
  socket.on("data", (chunk) => ws.readyState === ws.OPEN && ws.send(chunk));
  const close = () => {
    socket.destroy();
    if (ws.readyState === ws.OPEN) ws.close();
  };
  ws.on("close", close);
  ws.on("error", close);
  socket.on("close", close);
  socket.on("error", close);
});
wss.on("listening", () => console.log(`ws-bridge listening on 127.0.0.1:${port}`));
