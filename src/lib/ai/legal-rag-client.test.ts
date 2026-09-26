// Dostoori's side of the Phase 2 AI boundary: every call to ailegal_hussein
// is signed with a request-bound assertion (never the key itself, never a
// free-form office header), and every response is validated before use.
// fetch is mocked; the assertion is verified here with the same algorithm the
// engine uses (ailegal_hussein/src/lib/service-auth.ts checkAssertion).
import { createHash, createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'test-shared-secret'
const ACTOR = { id: 'user-42', officeId: 'office-123' }

function verify(token: string, req: { method: string; path: string; body: string }) {
  const [v, payloadPart, sig] = token.split('.')
  expect(v).toBe('v1')
  const expected = createHmac('sha256', KEY).update(`v1.${payloadPart}`).digest('base64url')
  expect(sig).toBe(expected)
  const p = JSON.parse(Buffer.from(payloadPart, 'base64url').toString())
  expect(p.iss).toBe('dostoori')
  expect(p.aud).toBe('ailegal_hussein')
  expect(p.m).toBe(req.method)
  expect(p.p).toBe(req.path)
  expect(p.bh).toBe(createHash('sha256').update(req.body).digest('base64url'))
  expect(p.exp - p.iat).toBeLessThanOrEqual(120)
  expect(p.jti).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  return p as { off: string; usr: string; jti: string }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const usage = { requestId: 'req-1', llmCalls: 2, failedCalls: 0, tokensIn: 1200, tokensOut: 150, embeddingTokens: 20, estimatedCostUsd: 0.00027, byPurpose: { answer: 1 } }
const provenance = { promptVersion: 'p2-abc', corpusVersion: 'c-def', chatModels: ['gpt-4o-mini'], embeddingModel: 'text-embedding-3-small' }
const source = { ref: 1, id: 7, sourceId: 3, title: 'قانون العمل', sourceType: 'law', articleNumber: '17', lawName: 'قانون العمل', court: null, decisionNumber: null, year: 1996, category: null, excerpt: 'نص', isCurrentVersion: true, effectiveDate: null, provenance: 'official', cited: true }
const chatOk = { answer: 'الخلاصة: … [1].', mode: 'grounded', groundingLevel: 'full', grounded: true, sources: [source], notices: [], disclaimer: 'تنبيه', confidence: { label: 'عالية', score: 0.8 }, usage, provenance }

beforeEach(() => {
  vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
  vi.stubEnv('AI_LEGAL_SERVICE_KEY', KEY)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('configuration', () => {
  it('is not configured when the env vars are absent, and reads them live', async () => {
    vi.unstubAllEnvs()
    const { isLegalRagConfigured } = await import('./legal-rag-client')
    expect(isLegalRagConfigured()).toBe(false)
    vi.stubEnv('AI_LEGAL_SERVICE_URL', 'http://localhost:3001')
    vi.stubEnv('AI_LEGAL_SERVICE_KEY', 'k')
    expect(isLegalRagConfigured()).toBe(true)
  })
})

describe('askLegalRag — signed request, validated JSON response', () => {
  it('POSTs JSON to /api/chat with a request-bound assertion for the session\'s office and user — never the key, never the retired headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(chatOk))
    vi.stubGlobal('fetch', fetchMock)
    const { askLegalRag } = await import('./legal-rag-client')
    const result = await askLegalRag('هل يجوز كذا؟', { category: 'عمل' }, ACTOR, [{ role: 'user', content: 'سؤال سابق' }])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/chat')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.headers['X-Internal-Service-Key']).toBeUndefined()
    expect(init.headers['X-Dostoori-Office-Id']).toBeUndefined()
    expect(JSON.stringify(init.headers)).not.toContain(KEY)
    const claims = verify(init.headers['X-Dostoori-Assertion'], { method: 'POST', path: '/api/chat', body: init.body })
    expect(claims.off).toBe('office-123')
    expect(claims.usr).toBe('user-42')
    expect(JSON.parse(init.body)).toEqual({ question: 'هل يجوز كذا؟', filters: { category: 'عمل' }, history: [{ role: 'user', content: 'سؤال سابق' }] })
    expect(result.groundingLevel).toBe('full')
    expect(result.usage.tokensIn).toBe(1200)
    expect(result.provenance.corpusVersion).toBe('c-def')
  })

  it('mints a fresh single-use id for every request', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(chatOk))
    vi.stubGlobal('fetch', fetchMock)
    const { askLegalRag } = await import('./legal-rag-client')
    await askLegalRag('س1', undefined, ACTOR)
    await askLegalRag('س1', undefined, ACTOR)
    const jtis = fetchMock.mock.calls.map(([, init]) => verify(init.headers['X-Dostoori-Assertion'], { method: 'POST', path: '/api/chat', body: init.body }).jti)
    expect(new Set(jtis).size).toBe(2)
  })

  it.each([
    ['a grounded flag that contradicts the mode', { ...chatOk, mode: 'no_evidence' }],
    ['a citation marker past the source list', { ...chatOk, answer: 'ادعاء [4].' }],
    ['a missing usage report', { ...chatOk, usage: undefined }],
    ['an unknown mode', { ...chatOk, mode: 'freestyle' }],
    ['a non-string answer', { ...chatOk, answer: 42 }],
  ])('rejects a malformed engine response (%s) — nothing unvalidated reaches the user', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    await expect(askLegalRag('س', undefined, ACTOR)).rejects.toSatisfy((e: unknown) => e instanceof LegalRagError && e.status === 502 && e.code === 'malformed_output')
  })

  it('maps upstream statuses: 401 (bad signature) → 502 auth_rejected, 429 with Retry-After, 503, 504, 4xx message relayed', async () => {
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    const cases: [Response, number, string][] = [
      [jsonResponse({ error: 'x' }, 401), 502, 'auth_rejected'],
      [jsonResponse({ error: 'x' }, 429, { 'Retry-After': '30' }), 429, 'upstream_rate_limited'],
      [jsonResponse({ error: 'x' }, 503), 503, 'upstream_paused'],
      [jsonResponse({ error: 'انتهت مهلة معالجة الطلب' }, 504), 504, 'upstream_504'],
      [jsonResponse({ error: 'السؤال قصير جداً' }, 400), 400, 'upstream_400'],
    ]
    for (const [res, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
      await expect(askLegalRag('س', undefined, ACTOR)).rejects.toSatisfy((e: unknown) => e instanceof LegalRagError && e.status === status && e.code === code)
    }
  })

  it('an upstream that sends headers and then stalls ends in a 504 within the deadline', async () => {
    vi.stubEnv('AI_LEGAL_SERVICE_TIMEOUT_MS', '200')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"answer":'))
            init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
          },
        })
        return new Response(stream, { status: 200 })
      })
    )
    const { askLegalRag, LegalRagError } = await import('./legal-rag-client')
    const started = Date.now()
    await expect(askLegalRag('س', undefined, ACTOR)).rejects.toSatisfy((e: unknown) => e instanceof LegalRagError && e.status === 504)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('document features sign their own paths and validate their shapes', () => {
  const coverage = { totalChars: 100, analyzedChars: 100, partial: false, segments: 1, notAnalyzed: [] }

  it('analyzeContract → /api/contract-review, coverage passed through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ summary: 'ملخص', parties: ['أ'], keyTerms: [], risks: [{ severity: 'high', title: 'غرامة', excerpt: '', explanation: 'شرح [1]' }], coverage: { ...coverage, partial: true, notAnalyzed: [{ fromChar: 50, toChar: 100, startsWith: 'البند' }] }, sources: [source], usage, provenance })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { analyzeContract } = await import('./legal-rag-client')
    const r = await analyzeContract('نص العقد', ACTOR)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/contract-review')
    verify(init.headers['X-Dostoori-Assertion'], { method: 'POST', path: '/api/contract-review', body: init.body })
    expect(r.coverage.partial).toBe(true)
    expect(r.coverage.notAnalyzed[0].fromChar).toBe(50)
  })

  it('analyzeCaseText sends extracted TEXT (not the file) to /api/cases', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ analysis: { summary: 's', parties: [], facts: [], case_type: 'أخرى', cited_articles: [], legal_basis: [], possible_defenses: [], strengths: [], weaknesses: [], gaps: [] }, groundingLevel: 'none', coverage, sources: [], usage, provenance })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { analyzeCaseText } = await import('./legal-rag-client')
    await analyzeCaseText('نص القضية', 'case.pdf', ACTOR)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/cases')
    expect(JSON.parse(init.body)).toEqual({ caseText: 'نص القضية', fileName: 'case.pdf' })
    verify(init.headers['X-Dostoori-Assertion'], { method: 'POST', path: '/api/cases', body: init.body })
  })

  it('a case-analysis item citing a source that was not returned is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ analysis: { summary: 's', parties: [], facts: [], case_type: 'أخرى', cited_articles: [], legal_basis: [{ point: 'تكييف', citation: '[3]' }], possible_defenses: [], strengths: [], weaknesses: [], gaps: [] }, groundingLevel: 'full', coverage, sources: [source], usage, provenance })
      )
    )
    const { analyzeCaseText, LegalRagError } = await import('./legal-rag-client')
    await expect(analyzeCaseText('نص', 'f', ACTOR)).rejects.toSatisfy((e: unknown) => e instanceof LegalRagError && e.code === 'malformed_output')
  })

  it('generateDraft → /api/draft; exportDraft refuses bytes that are not the requested format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ draft: '# عقد\nنص [1]', grounded: true, groundingLevel: 'full', mode: 'drafted', validation: { unverifiedFacts: [{ kind: 'date', value: '1/1/2099' }] }, sources: [source], usage, provenance }))
    vi.stubGlobal('fetch', fetchMock)
    const { generateDraft, exportDraft, LegalRagError } = await import('./legal-rag-client')
    const d = await generateDraft('contract', { contract_type: 'إيجار' }, '', ACTOR)
    expect(d.unverifiedFacts).toBe(1)
    verify(fetchMock.mock.calls[0][1].headers['X-Dostoori-Assertion'], { method: 'POST', path: '/api/draft', body: fetchMock.mock.calls[0][1].body })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not a pdf</html>', { status: 200 })))
    await expect(exportDraft('# عقد', 'عقد', 'pdf', ACTOR)).rejects.toSatisfy((e: unknown) => e instanceof LegalRagError && e.code === 'malformed_output')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('%PDF-1.7 ...'), { status: 200 })))
    const file = await exportDraft('# عقد', 'عقد', 'pdf', ACTOR)
    expect(file.contentType).toBe('application/pdf')
  })
})
