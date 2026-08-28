// Proves Dostoori's server genuinely talks to ailegal_hussein's real HTTP
// contract (URL, headers, SSE event names) rather than some other or fake
// implementation — fetch is mocked here so this runs with no live service
// and no network, but the mock is shaped exactly like ailegal_hussein's own
// src/app/api/chat/route.ts (event: sources/delta/done, done.content
// overriding accumulated delta text) — see that file for the source of truth.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function sseResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return new Response(status === 204 ? null : stream, { status, headers })
}

describe('askLegalRag — the real ailegal_hussein HTTP contract', () => {
  beforeEach(() => {
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'test-shared-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('is not configured when the env vars are absent', async () => {
    vi.unstubAllEnvs()
    const { isLegalRagConfigured } = await import('./legal-rag-client')
    expect(isLegalRagConfigured()).toBe(false)
  })

  it('reflects the environment live, not a value snapshotted at import time', async () => {
    vi.unstubAllEnvs()
    const { isLegalRagConfigured } = await import('./legal-rag-client')
    expect(isLegalRagConfigured()).toBe(false)
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'k')
    expect(isLegalRagConfigured()).toBe(true)
  })

  it('POSTs to <service url>/api/chat with the internal-service auth headers and the question as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(
        'event: sources\ndata: []\n\n' +
          'event: delta\ndata: {"text":"إجابة"}\n\n' +
          'event: done\ndata: {"grounded":false,"mode":"refused","sources":[]}\n\n',
        200,
        { 'Content-Type': 'text/event-stream' }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const { askLegalRag } = await import('./legal-rag-client')
    await askLegalRag('هل يجوز كذا؟', { category: 'عمل' }, 'office-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/chat')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Internal-Service-Key']).toBe('test-shared-secret')
    expect(init.headers['X-Dostoori-Office-Id']).toBe('office-123')
    expect(JSON.parse(init.body)).toEqual({ question: 'هل يجوز كذا؟', filters: { category: 'عمل' } })
  })

  it('accumulates delta events into the answer when done has no content override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(
        'event: sources\ndata: [{"ref":1,"id":9,"title":"القانون المدني","sourceType":"law","articleNumber":"5","lawName":"القانون المدني الأردني","court":null,"decisionNumber":null,"year":1976,"category":null,"excerpt":"نص المادة"}]\n\n' +
          'event: delta\ndata: {"text":"الجزء الأول. "}\n\n' +
          'event: delta\ndata: {"text":"الجزء الثاني."}\n\n' +
          'event: done\ndata: {"grounded":true,"mode":"grounded","sources":[{"ref":1,"id":9,"title":"القانون المدني","sourceType":"law","articleNumber":"5","lawName":"القانون المدني الأردني","court":null,"decisionNumber":null,"year":1976,"category":null,"excerpt":"نص المادة"}],"disclaimer":"تنويه","confidence":"عالية"}\n\n'
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const { askLegalRag } = await import('./legal-rag-client')
    const result = await askLegalRag('سؤال', undefined, 'office-1')

    expect(result.answer).toBe('الجزء الأول. الجزء الثاني.')
    expect(result.grounded).toBe(true)
    expect(result.mode).toBe('grounded')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].lawName).toBe('القانون المدني الأردني')
    expect(result.disclaimer).toBe('تنويه')
    expect(result.confidence).toBe('عالية')
  })

  it('lets done.content override the accumulated delta text — matches ailegal_hussein\'s own client-rendering contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(
        'event: delta\ndata: {"text":"نص أولي سيُستبدل"}\n\n' +
          'event: done\ndata: {"grounded":true,"mode":"grounded_retry","content":"النص النهائي بعد الإصلاح","sources":[]}\n\n'
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const { askLegalRag } = await import('./legal-rag-client')
    const result = await askLegalRag('سؤال', undefined, 'office-1')
    expect(result.answer).toBe('النص النهائي بعد الإصلاح')
  })

  it('correctly parses SSE frames split arbitrarily across stream chunks', async () => {
    const full =
      'event: delta\ndata: {"text":"أ"}\n\n' + 'event: done\ndata: {"grounded":false,"mode":"refused","sources":[]}\n\n'
    const bytes = new TextEncoder().encode(full)
    // Split mid-frame — a real TCP stream gives no guarantee frames arrive whole.
    const splitAt = 10
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt))
        controller.enqueue(bytes.slice(splitAt))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })))

    const { askLegalRag } = await import('./legal-rag-client')
    const result = await askLegalRag('سؤال', undefined, 'office-1')
    expect(result.answer).toBe('أ')
  })

  it('maps a 429 from ailegal_hussein to a 429 LegalRagError, not a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '30' } })))
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    await expect(askLegalRag('سؤال', undefined, 'office-1')).rejects.toSatisfy(
      (e: unknown) => e instanceof LegalRagError && e.status === 429
    )
  })

  it('maps ailegal_hussein\'s own 503 (site-wide daily cost cap hit) to a 503, not a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    await expect(askLegalRag('سؤال', undefined, 'office-1')).rejects.toSatisfy(
      (e: unknown) => e instanceof LegalRagError && e.status === 503
    )
  })

  it('surfaces an in-stream "error" event as a LegalRagError instead of returning a partial result silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse('event: error\ndata: {"message":"تعذّر توليد الإجابة"}\n\n'))
    )
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    await expect(askLegalRag('سؤال', undefined, 'office-1')).rejects.toSatisfy(
      (e: unknown) => e instanceof LegalRagError && e.message === 'تعذّر توليد الإجابة'
    )
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('analyzeCaseFile — real /api/cases contract (multipart, plain JSON, not SSE)', () => {
  beforeEach(() => {
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'test-shared-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('POSTs the file as multipart/form-data to /api/cases with the internal-auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: 9, fileName: 'case.pdf', pages: 3, extractionMethod: 'pdf-text', analysis: { summary: 'ملخص' }, sources: [] })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { analyzeCaseFile } = await import('./legal-rag-client')
    const result = await analyzeCaseFile(Buffer.from('%PDF-1 fake'), 'case.pdf', 'office-7')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/cases')
    expect(init.headers['X-Internal-Service-Key']).toBe('test-shared-secret')
    expect(init.headers['X-Dostoori-Office-Id']).toBe('office-7')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
    expect(result.fileName).toBe('case.pdf')
    expect(result.pages).toBe(3)
  })

  it('surfaces the upstream error message and status on a non-2xx response, not a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'تعذّر استخراج نص كافٍ من الملف' }, 400)))
    const { analyzeCaseFile, LegalRagError } = await import('./legal-rag-client')
    await expect(analyzeCaseFile(Buffer.from('x'), 'x.pdf', 'office-1')).rejects.toSatisfy(
      (e: unknown) => e instanceof LegalRagError && e.status === 400 && e.message === 'تعذّر استخراج نص كافٍ من الملف'
    )
  })
})

describe('generateDraft — real /api/draft contract', () => {
  beforeEach(() => {
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'test-shared-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('POSTs {kind, fields, notes} as JSON and returns the draft/grounded/sources shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ draft: 'نص العقد الكامل', grounded: true, sources: [{ ref: 1, id: 5, title: 'القانون المدني' }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { generateDraft } = await import('./legal-rag-client')
    const result = await generateDraft('contract', { contract_type: 'إيجار', party_one_name: 'أ', party_two_name: 'ب', subject: 'شقة' }, '', 'office-3')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/draft')
    expect(JSON.parse(init.body)).toEqual({
      kind: 'contract',
      fields: { contract_type: 'إيجار', party_one_name: 'أ', party_two_name: 'ب', subject: 'شقة' },
      notes: '',
    })
    expect(result.draft).toBe('نص العقد الكامل')
    expect(result.grounded).toBe(true)
  })

  it('returns the honest ungrounded result when ailegal_hussein finds no basis at all (no sources, 200 OK)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ draft: 'لم أجد سنداً كافياً لهذا الطلب', grounded: false, sources: [] })))
    const { generateDraft } = await import('./legal-rag-client')
    const result = await generateDraft('contract', { contract_type: 'x', party_one_name: 'x', party_two_name: 'x', subject: 'x' }, '', 'office-1')
    expect(result.grounded).toBe(false)
    expect(result.sources).toEqual([])
  })
})

describe('exportDraft — real /api/draft/export contract (binary response)', () => {
  beforeEach(() => {
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'test-shared-secret')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns real file bytes with the right content type, not a JSON wrapper', async () => {
    const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // real DOCX/zip magic bytes
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(docxBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { exportDraft } = await import('./legal-rag-client')
    const file = await exportDraft('نص العقد', 'عقد الإيجار', 'docx', 'office-1')

    expect(file.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(Buffer.from(file.buffer)).toEqual(Buffer.from(docxBytes))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ draft: 'نص العقد', filename: 'عقد الإيجار', format: 'docx' })
  })

  it('reads the JSON error body on failure instead of trying to treat it as file bytes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'طلب غير صالح' }, 400)))
    const { exportDraft, LegalRagError } = await import('./legal-rag-client')
    await expect(exportDraft('', 'x', 'docx', 'office-1')).rejects.toSatisfy(
      (e: unknown) => e instanceof LegalRagError && e.message === 'طلب غير صالح'
    )
  })
})
