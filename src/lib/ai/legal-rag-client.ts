// Server-only by convention (called from Route Handlers only, like every
// other module under src/lib/ai/) — never imported from a client component.
// ailegal_hussein is a separate, standalone service — its own Next.js app,
// its own Postgres+pgvector corpus of real Jordanian legislation and case
// law, its own OpenAI key. This module never sees that key: it only calls
// ailegal_hussein's HTTP API, after Dostoori's own auth/tenant/rate-limit/
// monthly-cap checks have already run (see src/app/api/search/legal/route.ts).
// The two sides authenticate each other with a shared secret — see
// ailegal_hussein/src/lib/lawyer-auth.ts's requireLawyer() for the other end
// of this contract, and ARCHITECTURE.md for why this is an HTTP boundary
// rather than a code-level merge (different database engines entirely).
// A function, not a frozen module-level constant: @prisma/client's own
// runtime reloads .env on instantiation (see src/lib/prisma.ts), which can
// repopulate a var an integration test's setup deliberately deleted *after*
// this module was first imported but *before* the request under test
// actually runs. Reading process.env fresh on every call means "configured"
// always reflects the real, current environment instead of a value snapshot
// frozen at whatever moment this module happened to first load.
export function isLegalRagConfigured(): boolean {
  return Boolean(process.env.AI_LEGAL_SERVICE_URL?.trim() && process.env.AI_LEGAL_SERVICE_KEY?.trim())
}

export const LEGAL_RAG_TIMEOUT_MS = 30_000

export class LegalRagError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface LegalRagCitation {
  ref: number
  id: string | number
  title: string
  sourceType: string
  articleNumber: string | number | null
  lawName: string | null
  court: string | null
  decisionNumber: string | null
  year: number | null
  category: string | null
  excerpt: string
}

export interface LegalRagResult {
  answer: string
  grounded: boolean
  mode: string
  sources: LegalRagCitation[]
  disclaimer?: string
  confidence: string | null
}

export interface LegalRagFilters {
  category?: string
  court?: string
  year?: number
}

/**
 * Calls ailegal_hussein's real RAG pipeline (retrieval → grounded prompt →
 * citation guard → answer) over HTTP. Assumes the caller already did its own
 * auth/tenant/rate-limit/cost-cap checks — this function does none of that
 * itself, it only relays one office's identity so ailegal_hussein's own
 * per-caller rate limit and cost cap apply per Dostoori office, not shared
 * across all of them.
 */
export async function askLegalRag(
  question: string,
  filters: LegalRagFilters | undefined,
  officeId: string
): Promise<LegalRagResult> {
  const res = await callLegalService('/api/chat', officeId, {
    method: 'POST',
    body: JSON.stringify({ question, filters }),
    extraHeaders: { 'Content-Type': 'application/json' },
  })
  if (!res.ok || !res.body) throw new LegalRagError('تعذّر الحصول على استجابة من خدمة البحث القانوني', 502)
  return consumeChatStream(res.body)
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function serviceCoordinates(): { baseUrl: string; serviceKey: string } | null {
  const baseUrl = process.env.AI_LEGAL_SERVICE_URL?.trim()
  const serviceKey = process.env.AI_LEGAL_SERVICE_KEY?.trim()
  if (!baseUrl || !serviceKey) return null
  return { baseUrl, serviceKey }
}

/**
 * Shared plumbing for the three plain-JSON/binary ailegal_hussein endpoints
 * (/api/cases, /api/draft, /api/draft/export) — unlike /api/chat, none of
 * these stream SSE, so there's no frame parsing here, just the same auth
 * headers, timeout, and upstream-status mapping askLegalRag already has.
 */
async function callLegalService(
  path: string,
  officeId: string,
  init: { method: 'POST'; body: BodyInit; extraHeaders?: Record<string, string> },
  timeoutMs = LEGAL_RAG_TIMEOUT_MS
): Promise<Response> {
  const coords = serviceCoordinates()
  if (!coords) throw new LegalRagError('خدمة الذكاء الاصطناعي القانوني غير مُفعّلة على هذا الخادم حالياً', 503)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${coords.baseUrl}${path}`, {
      method: init.method,
      headers: {
        'X-Internal-Service-Key': coords.serviceKey,
        'X-Dostoori-Office-Id': officeId,
        ...init.extraHeaders,
      },
      body: init.body,
      signal: controller.signal,
    })
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    throw new LegalRagError(
      isAbort ? 'انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي القانوني' : 'تعذّر الاتصال بخدمة الذكاء الاصطناعي القانوني',
      isAbort ? 504 : 502
    )
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 401) throw new LegalRagError('فشل التحقق من خدمة الذكاء الاصطناعي القانوني — مفتاح الخدمة غير متطابق', 502)
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after')
    throw new LegalRagError(
      retryAfter ? `تجاوزت الخدمة الحد المسموح، حاول بعد ${retryAfter} ثانية` : 'تجاوزت الخدمة الحد المسموح، حاول لاحقاً',
      429
    )
  }
  if (res.status === 503) throw new LegalRagError('الخدمة متوقفة مؤقتاً (بلغت الحد اليومي للإنفاق)', 503)
  return res
}

async function readJsonOrThrow(res: Response, fallbackMessage: string): Promise<any> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new LegalRagError(typeof body?.error === 'string' ? body.error : fallbackMessage, res.status || 502)
  }
  if (!body) throw new LegalRagError(fallbackMessage, 502)
  return body
}

export interface CaseAnalysisResult {
  id: number | string
  fileName: string
  pages: number
  extractionMethod: string
  analysis: Record<string, unknown>
  sources: LegalRagCitation[]
}

/**
 * Sends an uploaded case/dispute file to ailegal_hussein's litigation-
 * analysis pipeline: real text extraction, grounded in the same real legal
 * corpus as askLegalRag, with the same citation-guard discipline. Framed
 * around a dispute (parties as plaintiff/defendant, possible defenses) —
 * not a bilateral agreement, which is why Dostoori's own contract review
 * (src/lib/ai/client.ts, Claude-based) stays on its current path instead of
 * routing through this endpoint. See ARCHITECTURE.md.
 */
export async function analyzeCaseFile(bytes: Buffer, filename: string, officeId: string): Promise<CaseAnalysisResult> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), filename)
  const res = await callLegalService('/api/cases', officeId, { method: 'POST', body: form }, 60_000)
  return readJsonOrThrow(res, 'تعذّر تحليل ملف القضية')
}

export type DraftKind = 'statement_of_claim' | 'reply' | 'defense_memo' | 'petition' | 'contract'

export interface DraftResult {
  draft: string
  grounded: boolean
  sources: LegalRagCitation[]
}

/**
 * Generates a real, grounded first draft from structured fields — the same
 * templates + retrieval + citation-guard pipeline askLegalRag uses, applied
 * to drafting instead of Q&A. `fields` keys must match ailegal_hussein's own
 * form spec for `kind` (src/lib/drafting/forms.ts there) — Dostoori's
 * contract-draft page mirrors that spec rather than inventing its own.
 */
export async function generateDraft(
  kind: DraftKind,
  fields: Record<string, string>,
  notes: string,
  officeId: string
): Promise<DraftResult> {
  const res = await callLegalService(
    '/api/draft',
    officeId,
    { method: 'POST', body: JSON.stringify({ kind, fields, notes }), extraHeaders: { 'Content-Type': 'application/json' } },
    60_000
  )
  return readJsonOrThrow(res, 'تعذّر توليد المسودة')
}

export interface ExportedFile {
  buffer: Buffer
  contentType: string
}

/** Converts already-generated draft text to a real DOCX or PDF file. */
export async function exportDraft(
  draft: string,
  filename: string,
  format: 'docx' | 'pdf',
  officeId: string
): Promise<ExportedFile> {
  const res = await callLegalService(
    '/api/draft/export',
    officeId,
    { method: 'POST', body: JSON.stringify({ draft, filename, format }), extraHeaders: { 'Content-Type': 'application/json' } },
    30_000
  )
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new LegalRagError(typeof body?.error === 'string' ? body.error : 'تعذّر تصدير الملف', res.status || 502)
  }
  const arrayBuffer = await res.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') ?? (format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  }
}

/**
 * ailegal_hussein's /api/chat streams Server-Sent Events (event: name /
 * data: json, blank-line-delimited) rather than returning one JSON body —
 * its own frontend renders the answer as it's generated. Dostoori has no
 * streaming UI yet (see Phase 4's assistant/contract-review pages), so this
 * buffers the whole stream server-side into one structured result. Real-time
 * streaming through to Dostoori's own frontend is a reasonable follow-up,
 * not attempted in this first integration.
 */
async function consumeChatStream(body: ReadableStream<Uint8Array>): Promise<LegalRagResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let deltaText = ''
  let sources: LegalRagCitation[] = []
  let doneEvent: Record<string, unknown> | null = null
  let errorMessage: string | null = null

  const processFrame = (frame: string) => {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return
    let data: unknown
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }

    if (event === 'delta' && data && typeof data === 'object') {
      const text = asString((data as Record<string, unknown>).text)
      if (text) deltaText += text
    } else if (event === 'sources' && Array.isArray(data)) {
      sources = data as LegalRagCitation[]
    } else if (event === 'done' && data && typeof data === 'object') {
      doneEvent = data as Record<string, unknown>
    } else if (event === 'error' && data && typeof data === 'object') {
      errorMessage = asString((data as Record<string, unknown>).message) ?? 'خطأ غير معروف من خدمة البحث القانوني'
    }
  }

  while (true) {
    const { value, done: streamDone } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      processFrame(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
  }
  if (buffer.trim()) processFrame(buffer)

  if (errorMessage) throw new LegalRagError(errorMessage, 502)
  if (!doneEvent) throw new LegalRagError('لم تصل إجابة كاملة من خدمة البحث القانوني', 502)

  const done = doneEvent as Record<string, unknown>
  // The client-facing contract on ailegal_hussein's own side: `content`, when
  // present, replaces the accumulated delta text wholesale (a gap-fill sweep
  // or a false-refusal recovery rewrote it) — see its route.ts's own comment
  // on this exact field for why.
  const content = asString(done.content)
  const finalSources = Array.isArray(done.sources) ? (done.sources as LegalRagCitation[]) : sources

  return {
    answer: (content ?? deltaText).trim(),
    grounded: Boolean(done.grounded),
    mode: asString(done.mode) ?? 'unknown',
    sources: finalSources,
    disclaimer: asString(done.disclaimer),
    confidence: asString(done.confidence) ?? null,
  }
}
