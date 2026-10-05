/**
 * Which database a command is about to touch, and whether it may write to it
 * (Phase 2.4). Shared by the app and the CLI scripts — no `server-only`
 * import. Nothing here ever prints a user name or a password.
 *
 * The environment is decided from facts the operator controls, in order:
 *   1. the host is listed in PRODUCTION_DATABASE_HOST (comma-separated)
 *      → production, whatever else is declared — a mislabelled production
 *      connection string is still refused;
 *   2. a loopback host (or the docker-compose service "db") → local;
 *   3. DATABASE_ENVIRONMENT = branch | staging | production, as declared;
 *   4. otherwise unknown.
 * A marker stored in the database itself would not do: a Neon branch is a
 * copy of its parent, marker included. Neon gives every branch its own
 * compute endpoint, so the host (endpoint id) is what tells them apart.
 */

export type DbEnvironment = "local" | "branch" | "staging" | "production" | "unknown";

export type DbTarget = {
  host: string;
  port: string;
  database: string;
  /** Neon compute endpoint id ("ep-…"), when the host is a Neon host. */
  neonEndpoint: string | null;
  environment: DbEnvironment;
  /** Why the environment was decided so. */
  basis: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);
const DECLARABLE: DbEnvironment[] = ["branch", "staging", "production"];

export function describeTarget(url: string, env: Readonly<Record<string, string | undefined>> = process.env): DbTarget {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { host: "(unparseable)", port: "?", database: "?", neonEndpoint: null, environment: "unknown", basis: "DATABASE_URL is not a URL" };
  }
  const host = u.hostname.toLowerCase();
  const base = {
    host,
    port: u.port || "5432",
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "(default)",
    neonEndpoint: /\.neon\.tech$/.test(host) ? host.split(".")[0].replace(/-pooler$/, "") : null,
  };
  const production = (env.PRODUCTION_DATABASE_HOST ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (production.includes(host) || (base.neonEndpoint && production.some((p) => p.split(".")[0].replace(/-pooler$/, "") === base.neonEndpoint))) {
    return { ...base, environment: "production", basis: "the host is listed in PRODUCTION_DATABASE_HOST" };
  }
  if (LOCAL_HOSTS.has(host)) return { ...base, environment: "local", basis: "loopback host" };
  const declared = (env.DATABASE_ENVIRONMENT ?? "").trim().toLowerCase() as DbEnvironment;
  if (DECLARABLE.includes(declared)) return { ...base, environment: declared, basis: "DATABASE_ENVIRONMENT" };
  return { ...base, environment: "unknown", basis: "a remote host, and no DATABASE_ENVIRONMENT declared" };
}

/** The connection string with its user and password removed — safe to print. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    for (const k of [...u.searchParams.keys()]) if (/pass|secret|token|key/i.test(k)) u.searchParams.set(k, "…");
    return u.toString();
  } catch {
    return "(unparseable)";
  }
}

export function targetLine(t: DbTarget): string {
  return `${t.host}:${t.port}/${t.database}${t.neonEndpoint ? ` (Neon endpoint ${t.neonEndpoint})` : ""} — ${t.environment.toUpperCase()} (${t.basis})`;
}

/**
 * A write may proceed on a local database, a declared branch or staging copy,
 * or production only when explicitly confirmed (--confirm-production). An
 * unknown remote target is refused: declare it first.
 */
export function assertMayMutate(t: DbTarget, opts: { confirmProduction: boolean; what: string }): void {
  if (t.environment === "local" || t.environment === "branch" || t.environment === "staging") return;
  if (t.environment === "production") {
    if (opts.confirmProduction) return;
    throw new Error(
      `${opts.what}: refused on PRODUCTION (${targetLine(t)}). Run it on a Neon branch first; on production add --confirm-production.`
    );
  }
  throw new Error(
    `${opts.what}: refused — ${targetLine(t)}. Declare the target: DATABASE_ENVIRONMENT=branch (a Neon branch / copy) or staging; ` +
      "list production hosts in PRODUCTION_DATABASE_HOST so they can never be mislabelled."
  );
}
