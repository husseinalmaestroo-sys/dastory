import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as aiAssistant } from '@/app/api/ai/assistant/route'
import { POST as contractReview } from '@/app/api/ai/contract-review/route'
import { POST as runOcr } from '@/app/api/documents/[id]/ocr/route'
import { POST as signDocument, GET as getSignatures } from '@/app/api/documents/[id]/sign/route'
import { cleanupOffice, createTestOfficeUser, readJson, testFormRequest, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
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
  // No ANTHROPIC_API_KEY in the integration test environment (see
  // vitest.integration.setup.mts) — this itself is the test that the
  // feature does NOT fake a response when unconfigured: it must 503, never
  // return a fabricated answer.
  it('assistant requires authentication', async () => {
    const res = await aiAssistant(testRequest('/api/ai/assistant', { method: 'POST', body: { message: 'hello' } }))
    expect(res.status).toBe(401)
  })

  it('assistant returns 503 (not a fake answer) when no provider key is configured', async () => {
    const user = await trackedUser()
    const res = await aiAssistant(testRequest('/api/ai/assistant', { method: 'POST', user, body: { message: 'ما هي مدة التقادم؟' } }))
    expect(res.status).toBe(503)
    const body = await readJson(res)
    expect(body.text).toBeUndefined() // never a canned/fake text field alongside the error
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
