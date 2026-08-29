import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as aiAssistant } from '@/app/api/ai/assistant/route'
import { POST as contractReview } from '@/app/api/ai/contract-review/route'
import { POST as legalSearch } from '@/app/api/search/legal/route'
import { POST as caseAnalysis } from '@/app/api/ai/case-analysis/route'
import { POST as contractDraft } from '@/app/api/ai/contract-draft/route'
import { POST as exportDraftRoute } from '@/app/api/ai/contract-draft/export/route'
import { POST as runOcr } from '@/app/api/documents/[id]/ocr/route'
import { POST as signDocument, GET as getSignatures } from '@/app/api/documents/[id]/sign/route'
import { cleanupOffice, createTestOfficeUser, readJson, testFormRequest, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

// vitest.integration.setup.mts already deletes these before this file's own
// imports run — but @prisma/client's own .env reload (triggered by `import
// { prisma }` a few lines up, transitively via helpers.ts) happens *during*
// that import, i.e. after the setup file's deletes and before any test body.
// Deleting again here, in a hook that runs after all of this file's imports
// have fully resolved, is what actually makes "not configured" reflect this
// file's real intent regardless of what a developer's local .env contains
// (see isLegalRagConfigured's own comment in legal-rag-client.ts).
beforeEach(() => {
  delete process.env.AI_LEGAL_SERVICE_URL
  delete process.env.AI_LEGAL_SERVICE_KEY
})
async function trackedUser() {
  const user = await createTestOfficeUser()
  createdOffices.push(user.officeId)
  return user
}

function pngFormData(fieldName: string, filename = 'sig.png') {
  const fd = new FormData()
  // Minimal valid 1x1 PNG signature bytes.
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  fd.append(fieldName, new File([bytes], filename, { type: 'image/png' }))
  return fd
}

describe('AI routes — auth, tenant isolation, and honest "not configured" behavior', () => {
  // No AI_LEGAL_SERVICE_URL/KEY in the integration test environment (see
  // vitest.integration.setup.mts) — every route in this block now calls
  // ailegal_hussein, not Anthropic (client.ts and @anthropic-ai/sdk were
  // removed once nothing in the app called them anymore — see
  // ARCHITECTURE.md). This IS the test that each feature does NOT fake a
  // response when unconfigured: it must 503, never return a fabricated answer.
  it('assistant requires authentication', async () => {
    const res = await aiAssistant(testRequest('/api/ai/assistant', { method: 'POST', body: { message: 'hello' } }))
    expect(res.status).toBe(401)
  })

  it('assistant returns 503 (not a fake answer) when ailegal_hussein is not configured', async () => {
    const user = await trackedUser()
    const res = await aiAssistant(testRequest('/api/ai/assistant', { method: 'POST', user, body: { message: 'ما هي مدة التقادم؟' } }))
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.answer).toBeUndefined() // never a canned/fake answer field alongside the error
  })

  it('assistant rejects an empty message', async () => {
    const user = await trackedUser()
    const res = await aiAssistant(testRequest('/api/ai/assistant', { method: 'POST', user, body: { message: '' } }))
    expect(res.status).toBe(400)
  })

  it('contract review requires authentication', async () => {
    const res = await contractReview(testRequest('/api/ai/contract-review', { method: 'POST', body: { documentId: 'x' } }))
    expect(res.status).toBe(401)
  })

  it('contract review 404s on a document from another office before ever reaching the AI provider', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'contract.pdf', type: 'PDF', officeId: officeA.officeId, ownerId: officeA.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    const res = await contractReview(testRequest('/api/ai/contract-review', { method: 'POST', user: officeB, body: { documentId: doc.id } }))
    expect(res.status).toBe(404)
  })

  it('contract review returns 503 (not a fake analysis) when ailegal_hussein is not configured', async () => {
    const user = await trackedUser()
    const { writeDocumentFile } = await import('@/lib/document-storage')
    const url = await writeDocumentFile(user.officeId, user.id, 'contract.pdf', 'PDF', Buffer.from('%PDF-1 fake'))
    const doc = await prisma.document.create({ data: { name: 'contract.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url } })
    const res = await contractReview(testRequest('/api/ai/contract-review', { method: 'POST', user, body: { documentId: doc.id } }))
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.summary).toBeUndefined() // never a canned/fake analysis field alongside the error
  })
})

describe('legal search — calls ailegal_hussein, never a fake local answer', () => {
  // No AI_LEGAL_SERVICE_URL/KEY in the integration test environment (see
  // vitest.integration.setup.mts), same reasoning as the assistant's 503
  // test above: this IS the test that the feature does not fall back to a
  // fabricated answer when the upstream service isn't configured. The real
  // HTTP contract (headers, SSE parsing) is covered separately, with fetch
  // mocked, in src/lib/ai/legal-rag-client.test.ts.
  it('requires authentication', async () => {
    const res = await legalSearch(testRequest('/api/search/legal', { method: 'POST', body: { question: 'test' } }))
    expect(res.status).toBe(401)
  })

  it('returns 503 (not a fake answer) when ailegal_hussein is not configured', async () => {
    const user = await trackedUser()
    const res = await legalSearch(testRequest('/api/search/legal', { method: 'POST', user, body: { question: 'ما هي مدة التقادم؟' } }))
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.answer).toBeUndefined() // never a canned/fake answer field alongside the error
  })

  it('rejects an empty question', async () => {
    const user = await trackedUser()
    const res = await legalSearch(testRequest('/api/search/legal', { method: 'POST', user, body: { question: '' } }))
    expect(res.status).toBe(400)
  })

  it('rejects a question over the length cap', async () => {
    const user = await trackedUser()
    const res = await legalSearch(testRequest('/api/search/legal', { method: 'POST', user, body: { question: 'س'.repeat(2001) } }))
    expect(res.status).toBe(400)
  })
})

describe('AI case analysis — calls ailegal_hussein, tenant-scoped like OCR/contract-review', () => {
  it('requires authentication', async () => {
    const res = await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', body: { documentId: 'x' } }))
    expect(res.status).toBe(401)
  })

  it('404s on a document from another office before ever reaching ailegal_hussein', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'case.pdf', type: 'PDF', officeId: officeA.officeId, ownerId: officeA.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })
    const res = await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user: officeB, body: { documentId: doc.id } }))
    expect(res.status).toBe(404)
  })

  it('returns 503 (not a fake analysis) when ailegal_hussein is not configured', async () => {
    const user = await trackedUser()
    const { writeDocumentFile } = await import('@/lib/document-storage')
    const url = await writeDocumentFile(user.officeId, user.id, 'case.pdf', 'PDF', Buffer.from('%PDF-1 fake'))
    const doc = await prisma.document.create({ data: { name: 'case.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url } })
    const res = await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user, body: { documentId: doc.id } }))
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.analysis).toBeUndefined()
  })

  it('rejects a request with no documentId', async () => {
    const user = await trackedUser()
    const res = await caseAnalysis(testRequest('/api/ai/case-analysis', { method: 'POST', user, body: {} }))
    expect(res.status).toBe(400)
  })
})

describe('AI contract drafting — calls ailegal_hussein, never a locally-fabricated draft', () => {
  it('requires authentication', async () => {
    const res = await contractDraft(testRequest('/api/ai/contract-draft', { method: 'POST', body: { fields: {} } }))
    expect(res.status).toBe(401)
  })

  it('rejects a request missing required fields with no compensating notes', async () => {
    const user = await trackedUser()
    const res = await contractDraft(testRequest('/api/ai/contract-draft', { method: 'POST', user, body: { fields: {} } }))
    expect(res.status).toBe(400)
  })

  it('returns 503 (not a fake draft) when ailegal_hussein is not configured, even with valid fields', async () => {
    const user = await trackedUser()
    const res = await contractDraft(
      testRequest('/api/ai/contract-draft', {
        method: 'POST',
        user,
        body: { fields: { contract_type: 'إيجار', party_one_name: 'أحمد', party_two_name: 'سالم', subject: 'شقة سكنية' } },
      })
    )
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.draft).toBeUndefined()
  })

  it('accepts a request where required fields are missing but substantial notes compensate', async () => {
    const user = await trackedUser()
    // Still 503 (not configured) — this proves the *validation* layer accepts
    // notes-only input and lets it through to the (unconfigured) service,
    // rather than bouncing it at the 400 stage the field-based test above hits.
    const res = await contractDraft(
      testRequest('/api/ai/contract-draft', {
        method: 'POST',
        user,
        body: { fields: {}, notes: 'عقد إيجار شقة سكنية بين أحمد ومالك العقار لمدة سنة واحدة بدءاً من الشهر القادم' },
      })
    )
    expect(res.status).toBe(503)
  })

  it('export requires authentication', async () => {
    const res = await exportDraftRoute(testRequest('/api/ai/contract-draft/export', { method: 'POST', body: { draft: 'x', format: 'docx' } }))
    expect(res.status).toBe(401)
  })

  it('export rejects an empty draft', async () => {
    const user = await trackedUser()
    const res = await exportDraftRoute(testRequest('/api/ai/contract-draft/export', { method: 'POST', user, body: { draft: '', format: 'docx' } }))
    expect(res.status).toBe(400)
  })

  it('export returns 503 (not a fake file) when ailegal_hussein is not configured', async () => {
    const user = await trackedUser()
    const res = await exportDraftRoute(testRequest('/api/ai/contract-draft/export', { method: 'POST', user, body: { draft: 'نص العقد', format: 'docx' } }))
    // export/route.ts has no explicit isLegalRagConfigured() check of its own
    // (mirrors ailegal_hussein's own export endpoint, which isn't behind
    // requireLawyer either) — but exportDraft() shares callLegalService()
    // with every other function here, which checks configuration before
    // attempting any network call, so the 503 still comes from the same
    // single source of truth rather than needing its own duplicate check.
    expect(res.status).toBe(503)
  })
})

describe('document OCR — real pipeline, tenant-scoped', () => {
  it('requires authentication', async () => {
    const res = await runOcr(testRequest('/api/documents/x/ocr', { method: 'POST' }), testParams({ id: 'x' }))
    expect(res.status).toBe(401)
  })

  it('404s for a document belonging to another office', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'scan.png', type: 'PNG', officeId: officeA.officeId, ownerId: officeA.id, url: 'case-documents/nonexistent/nonexistent.png' },
    })

    const res = await runOcr(testRequest(`/api/documents/${doc.id}/ocr`, { method: 'POST', user: officeB }), testParams({ id: doc.id }))
    expect(res.status).toBe(404)
  })

  it('404s cleanly (not a 500 crash) when the stored file is missing from disk', async () => {
    const user = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'missing.png', type: 'PNG', officeId: user.officeId, ownerId: user.id, url: 'case-documents/nonexistent/nonexistent.png' },
    })
    const res = await runOcr(testRequest(`/api/documents/${doc.id}/ocr`, { method: 'POST', user }), testParams({ id: doc.id }))
    expect(res.status).toBe(404) // file read fails before extraction even starts
  })
})

describe('document signing — real hash-based audit trail, not a legal-signature claim', () => {
  it('requires authentication', async () => {
    const res = await signDocument(testRequest('/api/documents/x/sign', { method: 'POST' }), testParams({ id: 'x' }))
    expect(res.status).toBe(401)
  })

  it('signing a real document records a genuine sha256 hash of its actual bytes, tied to the signer', async () => {
    const user = await trackedUser()
    const targetBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x41, 0x42, 0x43]) // "%PDF-1ABC"
    // Write the real bytes the route will hash, via the same writer it uses.
    const { writeDocumentFile } = await import('@/lib/document-storage')
    const writtenUrl = await writeDocumentFile(user.officeId, user.id, 'target.pdf', 'PDF', Buffer.from(targetBytes))
    const targetDoc = await prisma.document.create({
      data: { name: 'target.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url: writtenUrl },
    })

    const res = await signDocument(
      testFormRequest(`/api/documents/${targetDoc.id}/sign`, { user, formData: pngFormData('signatureImage') }),
      testParams({ id: targetDoc.id })
    )
    expect(res.status).toBe(201)
    const body = await readJson(res)
    expect(body.documentHash).toMatch(/^[0-9a-f]{64}$/) // a real sha256 hex digest, not a placeholder
    expect(body.disclosure).toContain('ليست توقيعاً إلكترونياً موثقاً قانونياً')

    // The hash is verifiably correct — recompute it independently.
    const { createHash } = await import('crypto')
    const expectedHash = createHash('sha256').update(Buffer.from(targetBytes)).digest('hex')
    expect(body.documentHash).toBe(expectedHash)

    // Audit trail is readable and reports the document as untampered.
    const auditRes = await getSignatures(testRequest(`/api/documents/${targetDoc.id}/sign`, { user }), testParams({ id: targetDoc.id }))
    const auditBody = await readJson(auditRes)
    expect(auditBody.signatures).toHaveLength(1)
    expect(auditBody.signatures[0].matchesCurrentDocument).toBe(true)
  })

  it('cannot sign a document belonging to another office', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'other.pdf', type: 'PDF', officeId: officeA.officeId, ownerId: officeA.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    const res = await signDocument(
      testFormRequest(`/api/documents/${doc.id}/sign`, { user: officeB, formData: pngFormData('signatureImage') }),
      testParams({ id: doc.id })
    )
    expect(res.status).toBe(404)
  })

  it('rejects a signing request with no image attached', async () => {
    const user = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'target2.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })
    const res = await signDocument(
      testFormRequest(`/api/documents/${doc.id}/sign`, { user, formData: new FormData() }),
      testParams({ id: doc.id })
    )
    expect(res.status).toBe(400)
  })
})
