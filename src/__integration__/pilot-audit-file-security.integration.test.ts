// 10-firm pilot security audit — Section 6/14 (document + file security) at
// the upload ROUTE, not the storage-layer unit (document-storage.test.ts
// already covers path-traversal filenames and out-of-root writes there).
// This targets what only the route itself enforces: the extension allowlist,
// the magic-byte signature check (a file's actual bytes vs. its claimed
// type), the size cap, and cross-tenant caseId attachment.
import { afterEach, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as uploadDocument } from '@/app/api/documents/upload/route'
import { cleanupOffice, createTestOfficeUser, readJson, testFormRequest, type TestUser } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser(): Promise<TestUser> {
  const user = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(user.officeId)
  return user
}

function upload(user: TestUser, filename: string, bytes: Uint8Array, mimeType?: string, caseId?: string) {
  const fd = new FormData()
  fd.append('file', new File([bytes as BlobPart], filename, mimeType ? { type: mimeType } : undefined))
  if (caseId) fd.append('caseId', caseId)
  return uploadDocument(testFormRequest('/api/documents/upload', { user, formData: fd }))
}

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) // "%PDF-1"
const EXE_MAGIC = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) // "MZ..." — a real Windows PE header
const ELF_MAGIC = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]) // Linux ELF header

describe('file upload security — the route rejects what its claimed extension/MIME does not back up', () => {
  it('rejects a disallowed extension outright (.exe, .sh, .php)', async () => {
    const user = await trackedUser()
    for (const name of ['virus.exe', 'shell.sh', 'backdoor.php']) {
      const res = await upload(user, name, PDF_MAGIC)
      expect(res.status).toBe(400)
    }
  })

  it('double extension: "resume.pdf.exe" is judged by its LAST extension (.exe) and rejected — never silently treated as a PDF', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'resume.pdf.exe', PDF_MAGIC)
    expect(res.status).toBe(400)
  })

  it('an actual Windows PE executable renamed to .pdf is rejected — the magic-byte signature check catches what the extension lies about', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'invoice.pdf', EXE_MAGIC, 'application/pdf')
    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.error).toBeTruthy()
  })

  it('an ELF binary renamed to .docx is rejected the same way', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'contract.docx', ELF_MAGIC, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(res.status).toBe(400)
  })

  it('a MIME header that contradicts the extension is rejected even before the byte check', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'notes.txt', PDF_MAGIC, 'application/x-msdownload')
    expect(res.status).toBe(400)
  })

  it('an empty file is rejected', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'empty.pdf', new Uint8Array([]), 'application/pdf')
    expect(res.status).toBe(400)
  })

  it('a file over the 20MB cap is rejected without ever being written to disk', async () => {
    const user = await trackedUser()
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1)
    oversized.set(PDF_MAGIC)
    const res = await upload(user, 'huge.pdf', oversized, 'application/pdf')
    expect(res.status).toBe(413) // Payload Too Large (was a generic 400)
    const count = await prisma.document.count({ where: { officeId: user.officeId } })
    expect(count).toBe(0)
  })

  it('a "corrupted" PDF (correct extension and MIME, garbage bytes) fails the signature check, not a 500', async () => {
    const user = await trackedUser()
    const garbage = new TextEncoder().encode('this is not a pdf, just plain text pretending to be one')
    const res = await upload(user, 'broken.pdf', garbage, 'application/pdf')
    expect(res.status).toBe(400)
  })

  it('cannot attach an uploaded document to another office\'s case (404 before the file is ever written)', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Victim client', officeId: officeA.officeId, ownerId: officeA.id } })
    const kase = await prisma.case.create({
      data: { number: 'FILE-SEC-A', title: 'Victim case', type: 'مدني', officeId: officeA.officeId, clientId: client.id, ownerId: officeA.id },
    })

    const res = await upload(officeB, 'sneaky.pdf', PDF_MAGIC, 'application/pdf', kase.id)
    expect(res.status).toBe(404)

    const leaked = await prisma.document.findFirst({ where: { caseId: kase.id, officeId: officeB.officeId } })
    expect(leaked).toBeNull()
  })

  it('a legitimate PDF is accepted and stored only under the uploader\'s own office/user directory', async () => {
    const user = await trackedUser()
    const res = await upload(user, 'legit.pdf', PDF_MAGIC, 'application/pdf')
    expect(res.status).toBe(200)
    const doc = await readJson(res)
    const stored = await prisma.document.findUnique({ where: { id: doc.id } })
    expect(stored?.url?.startsWith(`case-documents/${user.officeId}/${user.id}/`)).toBe(true)
  })
})
