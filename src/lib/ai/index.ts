import "server-only";
import { env } from "../env";
import type { ChatProvider, EmbeddingProvider } from "./provider";
import { openaiChatProvider, openaiEmbeddingProvider } from "./openai";
import { anthropicProvider } from "./anthropic";
import { voyageProvider } from "./voyage";

/**
 * Chat and embeddings are chosen independently.
 *
 * They have to be: Anthropic publishes no embeddings endpoint, so "use Claude"
 * necessarily means Claude for answers plus someone else for vectors. The two
 * registries make that combination expressible instead of impossible.
 */

const chatProviders: Record<string, ChatProvider> = {
  openai: openaiChatProvider,
  anthropic: anthropicProvider,
};

const embeddingProviders: Record<string, EmbeddingProvider> = {
  openai: openaiEmbeddingProvider,
  voyage: voyageProvider,
};

export function getChatProvider(): ChatProvider {
  const p = chatProviders[env.chatProvider];
  if (!p) {
    throw new Error(
      `Unknown CHAT_PROVIDER "${env.chatProvider}". Registered: ${Object.keys(chatProviders).join(", ")}`
    );
  }
  return p;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const p = embeddingProviders[env.embeddingProvider];
  if (!p) {
    throw new Error(
      `Unknown EMBEDDING_PROVIDER "${env.embeddingProvider}". ` +
        `Registered: ${Object.keys(embeddingProviders).join(", ")}. ` +
        `Note: anthropic is not an option — Claude has no embeddings endpoint.`
    );
  }
  return p;
}

export type {
  ChatProvider,
  EmbeddingProvider,
  ChatMessage,
  ChatResult,
  EmbedResult,
} from "./provider";
