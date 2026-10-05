/**
 * The environment's proxy settings, read the standard way (HTTPS_PROXY,
 * NO_PROXY). No `server-only` import: the CLI scripts — db:migrate among them,
 * which runs under plain tsx — use it through db-pool.ts. net/proxy.ts builds
 * the HTTP clients on top of it.
 */

export function httpsProxy(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  return env.HTTPS_PROXY || env.https_proxy || null;
}

/** NO_PROXY semantics: "*" (everything), an exact host, ".suffix" or "*.suffix" (subdomains), optional ":port". */
export function bypassesProxy(host: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const list = (env.NO_PROXY ?? env.no_proxy ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const h = host.toLowerCase();
  return list.some((entry) => {
    const e = entry.replace(/:\d+$/, "");
    if (e === "*") return true;
    if (e.startsWith("*.") || e.startsWith(".")) {
      const suffix = e.replace(/^\*?\./, "");
      return h === suffix || h.endsWith(`.${suffix}`);
    }
    return h === e;
  });
}
