import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phase 2.4: every provider call goes THROUGH the environment's HTTPS proxy
 * (where the egress policy is enforced), never around it — the real provider
 * code paths, against a local stand-in proxy that records what each asked to
 * reach and refuses it. Nothing leaves this machine.
 */

const KEYS = ["HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "COHERE_API_KEY", "EMBEDDING_PROVIDER", "CHAT_PROVIDER", "RERANK_PROVIDER"];

test("the OpenAI, Anthropic and reranker calls ask the proxy for their host; a NO_PROXY host bypasses it", async () => {
  const seen: string[] = [];
  const proxy = createServer();
  proxy.on("connect", (req, socket) => {
    seen.push(req.url ?? "");
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    NO_PROXY: "direct.example.test",
    OPENAI_API_KEY: "sk-test-not-a-real-key",
    ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
    COHERE_API_KEY: "cohere-test-not-a-real-key",
    EMBEDDING_PROVIDER: "openai",
    CHAT_PROVIDER: "anthropic",
  });
  delete process.env.https_proxy;
  delete process.env.no_proxy;
  try {
    const { resetProxyAgents, proxyAgentFor, bypassesProxy } = await import("@/lib/net/proxy");
    resetProxyAgents();
    const { getEmbeddingProvider, getChatProvider } = await import("@/lib/ai");
    const { getRerankProvider } = await import("@/lib/ai/rerank");

    await assert.rejects(getEmbeddingProvider().embed(["اختبار"], "query"));
    assert.ok(seen.includes("api.openai.com:443"), `OpenAI embeddings: ${JSON.stringify(seen)}`);

    await assert.rejects(getChatProvider().chat([{ role: "user", content: "x" }], { maxTokens: 5, purpose: "test", timeoutMs: 5000 }));
    assert.ok(seen.includes("api.anthropic.com:443"), `Anthropic chat: ${JSON.stringify(seen)}`);

    await assert.rejects(getRerankProvider({ provider: "cohere" })!.rerank("q", ["d"], 1));
    assert.ok(seen.some((h) => /cohere/.test(h)), `Cohere rerank: ${JSON.stringify(seen)}`);

    assert.equal(proxyAgentFor("direct.example.test"), undefined, "a NO_PROXY host connects directly");
    assert.equal(bypassesProxy("a.svc.cluster.local", { NO_PROXY: "*.svc.cluster.local" }), true);
    assert.equal(bypassesProxy("api.openai.com", { NO_PROXY: "localhost,.anthropic.com" }), false);
    assert.equal(bypassesProxy("api.anthropic.com", { NO_PROXY: "localhost,.anthropic.com" }), true);
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    proxy.close();
  }
});
