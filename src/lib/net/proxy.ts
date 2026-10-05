import "server-only";
import type { Agent } from "node:http";
import HttpsProxyAgent from "https-proxy-agent";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { bypassesProxy, httpsProxy } from "./proxy-env";

export { bypassesProxy, httpsProxy };

/**
 * Outbound HTTPS from the engine goes THROUGH the environment's proxy when one
 * is configured (HTTPS_PROXY), never around it (Phase 2.4). The SDKs do not
 * read HTTPS_PROXY on their own: the OpenAI SDK and Node's built-in fetch
 * connect directly, so on a host whose egress policy is enforced at a proxy a
 * model call would either bypass the policy or fail in a way that names
 * neither. Hosts in NO_PROXY connect directly, as the environment intends.
 */

let agent: Agent | undefined;
/** A Node https Agent through the proxy (for the OpenAI SDK); undefined when there is no proxy or the host bypasses it. */
export function proxyAgentFor(host: string): Agent | undefined {
  const proxy = httpsProxy();
  if (!proxy || bypassesProxy(host)) return undefined;
  agent ??= new (HttpsProxyAgent as unknown as new (url: string) => Agent)(proxy);
  return agent;
}

let dispatcher: EnvHttpProxyAgent | undefined;
/**
 * fetch through the proxy — undici's own fetch with its EnvHttpProxyAgent,
 * which honours HTTPS_PROXY and NO_PROXY (one undici version on both sides,
 * not the copy bundled in Node). The global fetch when no proxy is set.
 */
export const proxiedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
  if (!httpsProxy()) return fetch(input, init);
  dispatcher ??= new EnvHttpProxyAgent();
  return undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher }) as unknown as Promise<Response>;
}) as typeof fetch;

/** Test hook: forget the cached agents (the proxy settings changed). */
export function resetProxyAgents(): void {
  agent = undefined;
  dispatcher = undefined;
}
