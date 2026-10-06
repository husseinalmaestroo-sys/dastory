// Server-only by convention (called from Route Handlers only, like every
// other module under src/lib/ai/) — never imported from a client component.
//
// ailegal_hussein is a separate service (its own Next.js app, Postgres +
// pgvector corpus of Jordanian legislation, its own model keys). This module
// only calls its HTTP API, after Dostoori's own auth / tenant / rate-limit /
// quota checks have run.
//
// PHASE 2 BOUNDARY
//   • Every request carries a signed, short-lived, single-use assertion
//     (service-assertion.ts) bound to the office and user of Dostoori's
//     server-side session, the method, the path and the exact body. The
//     shared key is never sent; the old X-Internal-Service-Key +
//     X-Dostoori-Office-Id headers are rejected by the engine.
//   • Responses are JSON (the engine's SSE stream is for its own UI) and are
//     validated strictly (engine-schema.ts) before anything reaches a route.
//   • The engine reports real usage (tokens, calls, estimated cost) and
//     provenance (prompt/corpus versions, models) with every answer.
//   • The engine keeps no content from these calls — Dostoori is the system
//     of record for its offices' questions, conversations and documents.
import { ASSERTION_HEADER, mintServiceAssertion } from './service-assertion'
import {
  EngineShapeError,
  parseCaseAnalysis,
  parseChatResponse,
  parseContractReview,
  parseDraft,
  type EngineCaseAnalysis,
  type EngineChatResult,
  type EngineContractReview,
  type EngineDraft,
} from './engine-schema'

// A function, not a frozen module-level constant: @prisma/client's own
// runtime reloads .env on instantiation (see src/lib/prisma.ts), which can
// repopulate a var an integration test's setup deliberately deleted *after*
// this module was first imported but *before* the request under test runs.
export function isLegalRagConfigured(): boolean {
  return Boolean(process.env.AI_LEGAL_SERVICE_URL?.trim() && process.env.AI_LEGAL_SERVICE_KEY?.trim())
}

/**
 * Per-call deadlines — each a little longer than the engine's own overall
 * deadline for that feature (ailegal_hussein/src/lib/ai/request.ts), so the
 * engine normally answers with a controlled 504 first; this deadline is the
 * backstop for an engine that stops answering at all.
 */
export const LEGAL_RAG_TIMEOUT_MS = 60_000
const DOCUMENT_TIMEOUT_MS = 120_000
const DRAFT_TIMEOUT_MS = 95_000
const EXPORT_TIMEOUT_MS = 35_000

/**
 * Deadline for one upstream call. `AI_LEGAL_SERVICE_TIMEOUT_MS`, if set,
 * overrides every per-endpoint default (operators tuning for a slow
 * upstream; tests exercising the stall path without waiting a minute).
 */
function deadlineMs(defaultMs: number): number {
  const override = Number(process.env.AI_LEGAL_SERVICE_TIMEOUT_MS)
  return Number.isFinite(override) && override > 0 ? override : defaultMs
}

export class LegalRagError extends Error {
  status: number
  /** Short machine-readable reason, recorded as the usage row's errorCode. */
  code: string
  constructor(message: string, status: number, code = String(status)) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Who the call is for — always taken from Dostoori's server-side session. */
export interface AiActor {
  id: string
  officeId: string
}

export type LegalRagCitation = EngineChatResult['sources'][number]
export type LegalRagResult = EngineChatResult
export interface LegalRagFilters {
  category?: string
  court?: string
  year?: number
}

/** Prior turns of the same conversation, oldest first — from Dostoori's own DB (conversations.ts), never from the client. */
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

/** Upstream error text is relayed to users; cap it so an upstream fault can't dump arbitrary internals into a response. */
const MAX_UPSTREAM_MESSAGE = 300
function upstreamMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() && value.length <= MAX_UPSTREAM_MESSAGE ? value : fallback
}

/** What the most common connection failures mean, for the server log. */
const CAUSE_HINTS: Record<string, string> = {
  ECONNREFUSED: 'nothing is listening there; is ailegal_hussein running (run-dev.bat starts it on port 4000)?',
  ENOTFOUND: 'the host name does not resolve; "legal_app" exists only inside Docker',
  EAI_AGAIN: 'the host name could not be resolved right now',
  ECONNRESET: 'the connection was reset',
  ETIMEDOUT: 'the connection timed out',
  EHOSTUNREACH: 'the host is unreachable',
}

function originOf(url: string): string {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? '(an invalid URL)' : origin // "localhost:4000" parses with "localhost:" as its scheme
  } catch {
    return '(an invalid URL)'
  }
}

/**
 * Why fetch rejected. Node's fetch throws TypeError('fetch failed') and puts
 * the socket error in `cause` (an AggregateError when both IPv4 and IPv6 were
 * tried). A URL that does not parse is reported as such, never echoed: the
 * message would repeat the whole value.
 */
function networkCause(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause
  const inner = cause instanceof AggregateError && cause.errors.length ? cause.errors[0] : cause
  const code = (inner as { code?: unknown } | null)?.code
  if (typeof code === 'string') return CAUSE_HINTS[code] ? `${code}: ${CAUSE_HINTS[code]}` : code
  if (err instanceof TypeError && /URL/i.test(err.message)) return 'AI_LEGAL_SERVICE_URL is not a valid URL'
  if (inner instanceof Error && !inner.message.includes('://')) return inner.message.slice(0, 120)
  return err instanceof Error ? err.name : 'unknown error'
}

/**
 * Shared plumbing for every ailegal_hussein call: signing, upstream status
 * mapping, and ONE deadline covering the whole exchange — connect, headers
 * and body. `consume` reads the body inside the deadline.
 */
async function callLegalService<T>(
  path: string,
  actor: AiActor,
  body: string,
  timeoutMs: number,
  consume: (res: Response) => Promise<T>
): Promise<T> {
  const baseUrl = process.env.AI_LEGAL_SERVICE_URL?.trim()
  const key = process.env.AI_LEGAL_SERVICE_KEY?.trim()
  if (!baseUrl || !key) throw new LegalRagError('خدمة الذكاء الاصطناعي القانوني غير مُفعّلة على هذا الخادم حالياً', 503, 'not_configured')

  const assertion = mintServiceAssertion(key, { officeId: actor.officeId, userId: actor.id, method: 'POST', path, body })
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deadlineMs(timeoutMs))

  try {
    let res: Response
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', [ASSERTION_HEADER]: assertion },
        body,
        signal: controller.signal,
      })
    } catch (err) {
      if (timedOut) throw new LegalRagError('انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي القانوني', 504, 'timeout')
      // The user sees "unreachable"; the operator needs to know why (nothing
      // listening, a host that does not resolve, a TLS failure) and where
      // Dostoori was trying to go. Origin only: never the key, path or query.
      console.error(`[legal-rag] ${path}: cannot reach ailegal_hussein at ${originOf(baseUrl)} — ${networkCause(err)}`)
      throw new LegalRagError('تعذّر الاتصال بخدمة الذكاء الاصطناعي القانوني', 502, 'unreachable')
    }

    if (res.status === 401) throw new LegalRagError('تعذّر التحقق من هوية الخدمة لدى خدمة الذكاء الاصطناعي القانوني', 502, 'auth_rejected')
    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after')
      const seconds = retryAfter && /^\d{1,6}$/.test(retryAfter) ? retryAfter : null
      throw new LegalRagError(
        seconds ? `تجاوزت الخدمة الحد المسموح، حاول بعد ${seconds} ثانية` : 'تجاوزت الخدمة الحد المسموح، حاول لاحقاً',
        429,
        'upstream_rate_limited'
      )
    }
    if (res.status === 503) throw new LegalRagError('الخدمة متوقفة مؤقتاً (بلغت الحد اليومي للإنفاق)', 503, 'upstream_paused')

    try {
      return await consume(res)
    } catch (err) {
      if (timedOut) throw new LegalRagError('انتهت مهلة انتظار الرد من خدمة الذكاء الاصطناعي القانوني', 504, 'timeout')
      if (err instanceof LegalRagError) throw err
      if (err instanceof EngineShapeError) {
        console.error('[legal-rag] rejected a malformed engine response:', err.message)
        throw new LegalRagError('وصلت استجابة غير صالحة من خدمة الذكاء الاصطناعي القانوني', 502, 'malformed_output')
      }
      throw new LegalRagError('وصلت استجابة غير صالحة من خدمة الذكاء الاصطناعي القانوني', 502, 'malformed_output')
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(res: Response, fallbackMessage: string): Promise<unknown> {
  // Read as text first so a stalled/aborted read surfaces as a rejection
  // (handled by callLegalService's deadline), not as "null JSON".
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    // Upstream 4xx carry a user-facing reason; 5xx become 502, 504 stays 504.
    const status = res.status === 504 ? 504 : res.status >= 400 && res.status < 500 ? res.status : 502
    throw new LegalRagError(upstreamMessage(body?.error, fallbackMessage), status, `upstream_${res.status}`)
  }
  if (!body) throw new LegalRagError(fallbackMessage, 502, 'malformed_output')
  return body
}

/** Grounded legal Q&A (retrieval → fenced prompt → claim-level grounding) over the engine's corpus. */
export async function askLegalRag(
  question: string,
  filters: LegalRagFilters | undefined,
  actor: AiActor,
  history?: ChatTurn[]
): Promise<LegalRagResult> {
  const body = JSON.stringify({ question, filters, history: history?.length ? history : undefined })
  return callLegalService('/api/chat', actor, body, LEGAL_RAG_TIMEOUT_MS, async (res) =>
    parseChatResponse(await readJson(res, 'تعذّر الحصول على استجابة من خدمة البحث القانوني'))
  )
}

export type CaseAnalysisResult = EngineCaseAnalysis

/**
 * Case/dispute analysis. Sends text Dostoori already extracted (its own
 * pipeline, OCR included) — the file itself never leaves Dostoori.
 */
export async function analyzeCaseText(caseText: string, fileName: string, actor: AiActor): Promise<CaseAnalysisResult> {
  const body = JSON.stringify({ caseText, fileName })
  return callLegalService('/api/cases', actor, body, DOCUMENT_TIMEOUT_MS, async (res) =>
    parseCaseAnalysis(await readJson(res, 'تعذّر تحليل ملف القضية'))
  )
}

export type ContractReviewResult = EngineContractReview

/** Contract review; long contracts are reviewed in segments and `coverage` says exactly what was analysed. */
export async function analyzeContract(contractText: string, actor: AiActor): Promise<ContractReviewResult> {
  const body = JSON.stringify({ contractText })
  return callLegalService('/api/contract-review', actor, body, DOCUMENT_TIMEOUT_MS, async (res) =>
    parseContractReview(await readJson(res, 'تعذّر مراجعة العقد'))
  )
}

export type DraftKind = 'statement_of_claim' | 'reply' | 'defense_memo' | 'petition' | 'contract'
export type DraftResult = EngineDraft

/** A first draft from structured fields; citations verified and unsupplied facts left as [يُستكمل]. */
export async function generateDraft(kind: DraftKind, fields: Record<string, string>, notes: string, actor: AiActor): Promise<DraftResult> {
  const body = JSON.stringify({ kind, fields, notes })
  return callLegalService('/api/draft', actor, body, DRAFT_TIMEOUT_MS, async (res) => parseDraft(await readJson(res, 'تعذّر توليد المسودة')))
}

export interface ExportedFile {
  buffer: Buffer
  contentType: string
}

/** Converts already-generated draft text to a DOCX or PDF file. */
export async function exportDraft(draft: string, filename: string, format: 'docx' | 'pdf', actor: AiActor): Promise<ExportedFile> {
  const body = JSON.stringify({ draft, filename, format })
  return callLegalService('/api/draft/export', actor, body, EXPORT_TIMEOUT_MS, async (res) => {
    if (!res.ok) await readJson(res, 'تعذّر تصدير الملف')
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    // Never relay the upstream Content-Type: the file is always one of these
    // two formats, served to the browser as a download — and check the bytes
    // are that format.
    const magicOk = format === 'pdf' ? buffer.subarray(0, 5).toString('latin1') === '%PDF-' : buffer.subarray(0, 2).toString('latin1') === 'PK'
    if (!magicOk) throw new LegalRagError('وصل ملف غير صالح من خدمة التصدير', 502, 'malformed_output')
    return {
      buffer,
      contentType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
  })
}
