import Anthropic from '@anthropic-ai/sdk'

// AI features are OPTIONAL infrastructure, unlike JWT_SECRET/DATABASE_URL:
// the app must still boot and every non-AI feature must still work with no
// key configured. So this does NOT use env.ts's fail-closed
// validateStrongSecret() pattern — it's a soft check, with isAiConfigured()
// as the single source of truth every AI route checks before doing
// anything else.
//
// A function, not a module-level const: the earlier const version froze its
// value at whatever moment this module first happened to load — harmless
// today only because ANTHROPIC_API_KEY has no real value in .env yet. The
// same shape caused a genuine bug in the sibling legal-rag-client.ts
// (isLegalRagConfigured, see its own comment): @prisma/client's own .env
// reload can repopulate a var an integration test deliberately deleted
// *after* this module was first imported but *before* the request under
// test actually runs, silently flipping "not configured" tests over to
// trying a real provider call. Reading process.env fresh on every call
// closes that off entirely, for the same reason it did there.
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

let client: Anthropic | null = null
export function getAnthropicClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

// Centralized so every AI route enforces the same cost/latency ceiling —
// one call site to tighten if usage patterns demand it, not N.
export const AI_MODEL = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5'
export const AI_MAX_OUTPUT_TOKENS = 2048
export const AI_REQUEST_TIMEOUT_MS = 30_000
