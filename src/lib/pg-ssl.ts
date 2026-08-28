/**
 * Shared by the app pool and by the CLI scripts, which each build their own
 * Pool. No `server-only` import: plain `tsx` scripts must be able to load it.
 */

export type SslOption = false | { rejectUnauthorized: boolean };

/**
 * Decides TLS from a Postgres connection string.
 *
 * node-postgres only enables SSL when told to. Neon's copy-paste URL carries
 * `?sslmode=require` and works; Supabase's does not, so the driver connects in
 * the clear, the server refuses, and the error mentions neither SSL nor the
 * fix. Any host that is not loopback is crossing a network, so require TLS
 * there by default. Loopback — the VPS's own docker-compose Postgres — needs
 * none and has no certificate to present.
 *
 * An explicit sslmode in the URL always wins, including `sslmode=disable`:
 * we return false and let pg parse the URL itself.
 */
export function sslFor(url: string): SslOption {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode")) return false;
    const host = u.hostname;
    // "db" is the docker-compose service name — same box, container network.
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
    return isLocal ? false : { rejectUnauthorized: true };
  } catch {
    // Not a parseable URL; let pg produce its own error rather than guessing.
    return false;
  }
}

/** Pool options for a connection string, SSL included when needed. */
export function poolConfig(url: string) {
  const ssl = sslFor(url);
  return {
    connectionString: url,
    ...(ssl === false ? {} : { ssl }),
  };
}
