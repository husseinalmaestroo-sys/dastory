import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as createClient, GET as listClients } from '@/app/api/clients/route'
import { PATCH as updateClient, DELETE as deleteClient, GET as getClient } from '@/app/api/clients/[id]/route'
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

describe('client lifecycle', () => {
  it('creates a client and it appears in the list', async () => {
    const user = await trackedUser()
    const res = await createClient(testRequest('/api/clients', { method: 'POST', user, body: { name: 'New Client', phone: '0791234567' } }))
    expect(res.status).toBe(201)

    const list = await readJson(await listClients(testRequest('/api/clients', { user })))
    expect(list.some((c: { name: string }) => c.name === 'New Client')).toBe(true)
  })

  it('rejects a client with no name', async () => {
    const user = await trackedUser()
    const res = await createClient(testRequest('/api/clients', { method: 'POST', user, body: { name: '' } }))
    expect(res.status).toBe(400)
  })

  it('updates a client\'s fields', async () => {
    const user = await trackedUser()
    const created = await readJson(await createClient(testRequest('/api/clients', { method: 'POST', user, body: { name: 'Original Name' } })))

    const res = await updateClient(testRequest(`/api/clients/${created.id}`, { method: 'PATCH', user, body: { name: 'Renamed' } }), testParams({ id: created.id }))
    expect(res.status).toBe(200)
    expect((await readJson(res)).name).toBe('Renamed')
  })

  it('soft-deletes a client (deactivates, does not remove the row)', async () => {
    const user = await trackedUser()
    const created = await readJson(await createClient(testRequest('/api/clients', { method: 'POST', user, body: { name: 'To Deactivate' } })))

    const res = await deleteClient(testRequest(`/api/clients/${created.id}`, { method: 'DELETE', user }), testParams({ id: created.id }))
    expect(res.status).toBe(200)

    const dbRow = await prisma.client.findUnique({ where: { id: created.id } })
    expect(dbRow).not.toBeNull() // row still exists
    expect(dbRow?.active).toBe(false) // just deactivated

    // A deactivated client no longer appears in the default (active-only) list.
    const list = await readJson(await listClients(testRequest('/api/clients', { user })))
    expect(list.some((c: { id: string }) => c.id === created.id)).toBe(false)
  })

  it('a deactivated client is still viewable directly by ID (just hidden from lists), reflecting active:false', async () => {
    const user = await trackedUser()
    const created = await readJson(await createClient(testRequest('/api/clients', { method: 'POST', user, body: { name: 'To Deactivate 2' } })))
    await deleteClient(testRequest(`/api/clients/${created.id}`, { method: 'DELETE', user }), testParams({ id: created.id }))

    const res = await getClient(testRequest(`/api/clients/${created.id}`, { user }), testParams({ id: created.id }))
    expect(res.status).toBe(200)
    expect((await readJson(res)).active).toBe(false)
  })
})
