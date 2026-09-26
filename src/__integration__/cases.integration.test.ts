import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as createCase, GET as listCases } from '@/app/api/cases/route'
import { PATCH as updateCase, DELETE as deleteCase } from '@/app/api/cases/[id]/route'
import { cleanupOffice, createTestOfficeUser, readJson, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser() {
  const user = await createTestOfficeUser()
  createdOffices.push(user.officeId)
  return user
}

describe('case creation and listing', () => {
  it('creates a case and it appears in the list', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Case Test Client', officeId: user.officeId, ownerId: user.id } })

    const res = await createCase(testRequest('/api/cases', { method: 'POST', user, body: { number: 'CT-1', title: 'Test Case', type: 'مدني', clientId: client.id } }))
    expect(res.status).toBe(201)

    const list = await readJson(await listCases(testRequest('/api/cases', { user })))
    expect(list.some((c: { number: string }) => c.number === 'CT-1')).toBe(true)
  })

  it('rejects a duplicate case number in the same office with 409, not a raw 500', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Case Test Client', officeId: user.officeId, ownerId: user.id } })
    await createCase(testRequest('/api/cases', { method: 'POST', user, body: { number: 'DUP-CASE', title: 'First', type: 'مدني', clientId: client.id } }))

    const res = await createCase(testRequest('/api/cases', { method: 'POST', user, body: { number: 'DUP-CASE', title: 'Second', type: 'مدني', clientId: client.id } }))
    expect(res.status).toBe(409)
    const body = await readJson(res)
    expect(body.error).toBeTruthy()
  })

  it('rejects creating a case for a client that does not exist', async () => {
    const user = await trackedUser()
    const res = await createCase(testRequest('/api/cases', { method: 'POST', user, body: { number: 'CT-2', title: 'Test', type: 'مدني', clientId: 'nonexistent-id' } }))
    expect(res.status).toBe(400)
  })
})

describe('case update', () => {
  it('updates fields and audit-logs the change', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Update Test Client', officeId: user.officeId, ownerId: user.id } })
    const created = await readJson(await createCase(testRequest('/api/cases', { method: 'POST', user, body: { number: 'UPD-1', title: 'Original', type: 'مدني', clientId: client.id } })))

    const res = await updateCase(testRequest(`/api/cases/${created.id}`, { method: 'PATCH', user, body: { title: 'Updated Title' } }), testParams({ id: created.id }))
    expect(res.status).toBe(200)
    const updated = await readJson(res)
    expect(updated.title).toBe('Updated Title')
  })
})

describe('case deletion — financial integrity', () => {
  it('detaches (does not delete) a PAID invoice when its case is deleted', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Delete Test Client', officeId: user.officeId, ownerId: user.id } })
    const kase = await prisma.case.create({ data: { number: 'DEL-CASE-1', title: 'To Delete', type: 'مدني', officeId: user.officeId, clientId: client.id, ownerId: user.id } })
    const invoice = await prisma.invoice.create({
      data: { number: 'DEL-INV-1', amount: 500, paid: 500, status: 'PAID', officeId: user.officeId, clientId: client.id, caseId: kase.id },
    })

    const res = await deleteCase(testRequest(`/api/cases/${kase.id}`, { method: 'DELETE', user }), testParams({ id: kase.id }))
    expect(res.status).toBe(200)

    const survivingInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } })
    expect(survivingInvoice).not.toBeNull()
    expect(survivingInvoice?.caseId).toBeNull()
    expect(survivingInvoice?.status).toBe('PAID')
    // Money is an exact DECIMAL(12,3) now — compare its decimal value, not a float.
    expect(survivingInvoice?.paid.toFixed(3)).toBe('500.000')
  })

  it('removes the case\'s document rows when the case is deleted', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Doc Delete Client', officeId: user.officeId, ownerId: user.id } })
    const kase = await prisma.case.create({ data: { number: 'DEL-CASE-2', title: 'To Delete', type: 'مدني', officeId: user.officeId, clientId: client.id, ownerId: user.id } })
    const document = await prisma.document.create({
      data: { name: 'test.pdf', type: 'PDF', officeId: user.officeId, ownerId: user.id, caseId: kase.id, url: 'case-documents/nonexistent/nonexistent.pdf' },
    })

    await deleteCase(testRequest(`/api/cases/${kase.id}`, { method: 'DELETE', user }), testParams({ id: kase.id }))

    const stillThere = await prisma.document.findUnique({ where: { id: document.id } })
    expect(stillThere).toBeNull()
  })

  it('removes the case\'s sessions when the case is deleted', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Session Delete Client', officeId: user.officeId, ownerId: user.id } })
    const kase = await prisma.case.create({ data: { number: 'DEL-CASE-3', title: 'To Delete', type: 'مدني', officeId: user.officeId, clientId: client.id, ownerId: user.id } })
    const session = await prisma.session.create({ data: { date: new Date(), time: '10:00', court: 'Test Court', officeId: user.officeId, caseId: kase.id } })

    await deleteCase(testRequest(`/api/cases/${kase.id}`, { method: 'DELETE', user }), testParams({ id: kase.id }))

    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull()
  })

  it('a user from another office cannot delete this office\'s case', async () => {
    const owner = await trackedUser()
    const outsider = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'X', officeId: owner.officeId, ownerId: owner.id } })
    const kase = await prisma.case.create({ data: { number: 'CROSS-DEL', title: 'X', type: 'مدني', officeId: owner.officeId, clientId: client.id, ownerId: owner.id } })

    const res = await deleteCase(testRequest(`/api/cases/${kase.id}`, { method: 'DELETE', user: outsider }), testParams({ id: kase.id }))
    expect(res.status).toBe(404)
    expect(await prisma.case.findUnique({ where: { id: kase.id } })).not.toBeNull()
  })
})
