import Anthropic from '@anthropic-ai/sdk'

// AI features are OPTIONAL infrastructure, unlike JWT_SECRET/DATABASE_URL:
// the app must still boot and every non-AI feature must still work with no
// key configured. So this does NOT use env.ts's fail-closed
// validateStrongSecret() pattern — it's a soft check, read lazily, with
// AI_CONFIGURED as the single source of truth every AI route checks before
// doing anything else.
export const AI_CONFIGURED = Boolean(process.env.ANTHROPIC_API_KEY?.trim())

let client: Anthropic | null = null
export function getAnthropicClient(): Anthropic {
  if (!AI_CONFIGURED) {
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
