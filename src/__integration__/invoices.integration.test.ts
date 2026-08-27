import { randomUUID } from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as createInvoice, GET as listInvoices } from '@/app/api/invoices/route'
import { DELETE as deleteInvoice } from '@/app/api/invoices/[id]/route'
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

describe('invoice creation', () => {
  it('creates an invoice for a client', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Invoice Client', officeId: user.officeId, ownerId: user.id } })

    const res = await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body: { number: 'INV-CT-1', amount: 250, clientId: client.id } }))
    expect(res.status).toBe(201)
  })

  it('rejects a duplicate invoice number in the same office with 409', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Invoice Client', officeId: user.officeId, ownerId: user.id } })
    await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body: { number: 'INV-DUP', amount: 100, clientId: client.id } }))

    const res = await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body: { number: 'INV-DUP', amount: 200, clientId: client.id } }))
    expect(res.status).toBe(409)
  })

  it('a sequential retry with the same Idempotency-Key does not create a duplicate invoice', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Idem Client', officeId: user.officeId, ownerId: user.id } })
    const key = randomUUID()
    const body = { number: 'INV-IDEM-1', amount: 300, clientId: client.id }

    const first = await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body, headers: { 'Idempotency-Key': key } }))
    const retry = await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body, headers: { 'Idempotency-Key': key } }))

    expect((await readJson(first)).id).toBe((await readJson(retry)).id)
    const count = await prisma.invoice.count({ where: { officeId: user.officeId, number: 'INV-IDEM-1' } })
    expect(count).toBe(1)
  })

  it('a concurrent double-submit with the same Idempotency-Key still creates exactly one invoice', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Concurrent Client', officeId: user.officeId, ownerId: user.id } })
    const key = randomUUID()
    const body = { number: 'INV-CONCURRENT-1', amount: 400, clientId: client.id }

    await Promise.all([
      createInvoice(testRequest('/api/invoices', { method: 'POST', user, body, headers: { 'Idempotency-Key': key } })),
      createInvoice(testRequest('/api/invoices', { method: 'POST', user, body, headers: { 'Idempotency-Key': key } })),
    ])

    const count = await prisma.invoice.count({ where: { officeId: user.officeId, number: 'INV-CONCURRENT-1' } })
    expect(count).toBe(1)
  })

  it('rejects paid exceeding amount', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'X', officeId: user.officeId, ownerId: user.id } })
    const res = await createInvoice(testRequest('/api/invoices', { method: 'POST', user, body: { number: 'INV-OVER', amount: 100, paid: 200, clientId: client.id } }))
    expect(res.status).toBe(400)
  })
})

describe('invoice deletion — financial guard', () => {
  it('blocks deleting a PAID invoice', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'X', officeId: user.officeId, ownerId: user.id } })
    const invoice = await prisma.invoice.create({ data: { number: 'PAID-DEL', amount: 500, paid: 500, status: 'PAID', officeId: user.officeId, clientId: client.id } })

    const res = await deleteInvoice(testRequest(`/api/invoices/${invoice.id}`, { method: 'DELETE', user }), testParams({ id: invoice.id }))
    expect(res.status).toBe(409)
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull()
  })

  it('allows deleting an unpaid invoice', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'X', officeId: user.officeId, ownerId: user.id } })
    const invoice = await prisma.invoice.create({ data: { number: 'UNPAID-DEL', amount: 500, officeId: user.officeId, clientId: client.id } })

    const res = await deleteInvoice(testRequest(`/api/invoices/${invoice.id}`, { method: 'DELETE', user }), testParams({ id: invoice.id }))
    expect(res.status).toBe(200)
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull()
  })

  it('a user cannot delete another office\'s invoice', async () => {
    const owner = await trackedUser()
    const outsider = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'X', officeId: owner.officeId, ownerId: owner.id } })
    const invoice = await prisma.invoice.create({ data: { number: 'CROSS-INV', amount: 100, officeId: owner.officeId, clientId: client.id } })

    const res = await deleteInvoice(testRequest(`/api/invoices/${invoice.id}`, { method: 'DELETE', user: outsider }), testParams({ id: invoice.id }))
    expect(res.status).toBe(404)
  })
})

describe('invoice pagination', () => {
  it('caps a page at the requested limit and reports total via header', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Page Client', officeId: user.officeId, ownerId: user.id } })
    for (let i = 0; i < 5; i++) {
      await prisma.invoice.create({ data: { number: `PAGE-INV-${i}`, amount: 10, officeId: user.officeId, clientId: client.id } })
    }

    const res = await listInvoices(testRequest('/api/invoices?limit=2', { user }))
    const page = await readJson(res)
    expect(page).toHaveLength(2)
    expect(res.headers.get('X-Has-More')).toBe('true')
    expect(res.headers.get('X-Total-Count')).toBe('5')
  })
})
