import { afterEach, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { POST as uploadDocument } from '@/app/api/documents/upload/route'
import { DELETE as deleteDocument } from '@/app/api/documents/[id]/route'
import { GET as downloadDocument } from '@/app/api/documents/[id]/download/route'
import { cleanupOffice, createColleague, createTestOfficeUser, readJson, testFormRequest, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser(role: Role = Role.OFFICE_MANAGER) {
  const user = await createTestOfficeUser({ role })
  createdOffices.push(user.officeId)
  return user
}

function pdfFormData(filename = 'test.pdf') {
  const fd = new FormData()
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) // "%PDF-1"
  fd.append('file', new File([bytes], filename, { type: 'application/pdf' }))
  return fd
}

describe('document upload', () => {
  it('uploads a real PDF and it is downloadable afterward', async () => {
    const user = await trackedUser()
    const res = await uploadDocument(testFormRequest('/api/documents/upload', { user, formData: pdfFormData() }))
    expect(res.status).toBe(200)
    const doc = await readJson(res)

    const downloadRes = await downloadDocument(testRequest(`/api/documents/${doc.id}/download`, { user }), testParams({ id: doc.id }))
    expect(downloadRes.status).toBe(200)

    // Clean up the real file this test wrote to disk.
    await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user }), testParams({ id: doc.id }))
  })
})

describe('document deletion — authorization', () => {
  it('the owner can delete their own document; it is gone afterward', async () => {
    const user = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'owned.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    const res = await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user }), testParams({ id: doc.id }))
    expect(res.status).toBe(200)
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toBeNull()
  })

  it('an unrelated lawyer in the SAME office (not owner, not case-owner) cannot delete it', async () => {
    const manager = await trackedUser(Role.OFFICE_MANAGER)
    const unrelatedLawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
    const doc = await prisma.document.create({
      data: { name: 'managers.pdf', type: 'PDF', officeId: manager.officeId, ownerId: manager.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    const res = await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user: unrelatedLawyer }), testParams({ id: doc.id }))
    expect(res.status).toBe(404)
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).not.toBeNull()
  })

  it('an office manager can delete any document in their office', async () => {
    const manager = await trackedUser(Role.OFFICE_MANAGER)
    const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
    const doc = await prisma.document.create({
      data: { name: 'lawyers.pdf', type: 'PDF', officeId: manager.officeId, ownerId: lawyer.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    const res = await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user: manager }), testParams({ id: doc.id }))
    expect(res.status).toBe(200)
  })

  it('deleting an already-deleted document 404s cleanly, not a crash', async () => {
    const user = await trackedUser()
    const doc = await prisma.document.create({
      data: { name: 'once.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })
    await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user }), testParams({ id: doc.id }))

    const res = await deleteDocument(testRequest(`/api/documents/${doc.id}`, { method: 'DELETE', user }), testParams({ id: doc.id }))
    expect(res.status).toBe(404)
  })
})
