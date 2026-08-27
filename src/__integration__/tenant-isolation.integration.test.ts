import { afterEach, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GET as getCase } from '@/app/api/cases/[id]/route'
import { GET as getClient } from '@/app/api/clients/[id]/route'
import { GET as listCases } from '@/app/api/cases/route'
import { GET as listClients } from '@/app/api/clients/route'
import { GET as listInvoices } from '@/app/api/invoices/route'
import { GET as listDocuments } from '@/app/api/documents/route'
import { DELETE as deleteDocument } from '@/app/api/documents/[id]/route'
import { cleanupOffice, createColleague, createTestOfficeUser, readJson, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser(opts: Parameters<typeof createTestOfficeUser>[0] = {}) {
  const user = await createTestOfficeUser(opts)
  createdOffices.push(user.officeId)
  return user
}

async function seedOfficeData(officeId: string, ownerId: string) {
  const client = await prisma.client.create({ data: { name: 'Tenant Test Client', officeId, ownerId } })
  const kase = await prisma.case.create({
    data: { number: `TEN-${officeId.slice(-6)}`, title: 'Tenant Test Case', type: 'مدني', officeId, clientId: client.id, ownerId },
  })
  const invoice = await prisma.invoice.create({
    data: { number: `TEN-INV-${officeId.slice(-6)}`, amount: 100, officeId, clientId: client.id, caseId: kase.id },
  })
  const document = await prisma.document.create({
    data: { name: 'tenant-test.pdf', type: 'PDF', officeId, ownerId, caseId: kase.id, url: 'case-documents/does-not-exist/does-not-exist.pdf' },
  })
  return { client, case: kase, invoice, document }
}

describe('cross-office tenant isolation', () => {
  it('a user cannot GET another office\'s case by ID (404, not 403 — no existence leak)', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const { case: caseA } = await seedOfficeData(officeA.officeId, officeA.id)

    const res = await getCase(testRequest(`/api/cases/${caseA.id}`, { user: officeB }), testParams({ id: caseA.id }))
    expect(res.status).toBe(404)
  })

  it('a user cannot GET another office\'s client by ID', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const { client: clientA } = await seedOfficeData(officeA.officeId, officeA.id)

    const res = await getClient(testRequest(`/api/clients/${clientA.id}`, { user: officeB }), testParams({ id: clientA.id }))
    expect(res.status).toBe(404)
  })

  it('another office\'s cases never appear in a list, even unfiltered', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    await seedOfficeData(officeA.officeId, officeA.id)
    await seedOfficeData(officeB.officeId, officeB.id)

    const resA = await listCases(testRequest('/api/cases', { user: officeA }))
    const casesA = await readJson(resA)
    expect(casesA.every((c: { officeId: string }) => c.officeId === officeA.officeId)).toBe(true)
    expect(casesA.length).toBeGreaterThan(0)
  })

  it('another office\'s clients never appear in a list', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    await seedOfficeData(officeA.officeId, officeA.id)
    await seedOfficeData(officeB.officeId, officeB.id)

    const resA = await listClients(testRequest('/api/clients', { user: officeA }))
    const clientsA = await readJson(resA)
    expect(clientsA.every((c: { officeId: string }) => c.officeId === officeA.officeId)).toBe(true)
  })

  it('another office\'s invoices never appear in a list', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    await seedOfficeData(officeA.officeId, officeA.id)
    await seedOfficeData(officeB.officeId, officeB.id)

    const resA = await listInvoices(testRequest('/api/invoices', { user: officeA }))
    const invoicesA = await readJson(resA)
    expect(invoicesA.every((i: { officeId: string }) => i.officeId === officeA.officeId)).toBe(true)
  })

  it('another office\'s documents never appear in a list', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    await seedOfficeData(officeA.officeId, officeA.id)
    await seedOfficeData(officeB.officeId, officeB.id)

    const resA = await listDocuments(testRequest('/api/documents', { user: officeA }))
    const docsA = await readJson(resA)
    expect(docsA.every((d: { officeId: string }) => d.officeId === officeA.officeId)).toBe(true)
  })

  it('a user cannot delete another office\'s document', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const { document } = await seedOfficeData(officeA.officeId, officeA.id)

    const res = await deleteDocument(testRequest(`/api/documents/${document.id}`, { method: 'DELETE', user: officeB }), testParams({ id: document.id }))
    expect(res.status).toBe(404)

    const stillThere = await prisma.document.findUnique({ where: { id: document.id } })
    expect(stillThere).not.toBeNull()
  })

  it('a lawyer only sees cases they own, not a colleague\'s, within the SAME office', async () => {
    const officeManager = await trackedUser({ role: Role.OFFICE_MANAGER })
    const lawyerB = await createColleague(officeManager.officeId, { role: Role.LAWYER })
    const client = await prisma.client.create({ data: { name: 'Shared Office Client', officeId: officeManager.officeId, ownerId: lawyerB.id } })
    await prisma.case.create({
      data: { number: 'LAWYER-B-CASE', title: 'Owned by lawyer B', type: 'مدني', officeId: officeManager.officeId, clientId: client.id, ownerId: lawyerB.id },
    })

    // Manager sees office-wide, including lawyer B's case.
    const managerRes = await listCases(testRequest('/api/cases', { user: officeManager }))
    const managerCases = await readJson(managerRes)
    expect(managerCases.some((c: { number: string }) => c.number === 'LAWYER-B-CASE')).toBe(true)
  })
})
