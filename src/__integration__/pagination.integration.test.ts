import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { GET as listCases } from '@/app/api/cases/route'
import { cleanupOffice, createTestOfficeUser, readJson, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})
async function trackedUser() {
  const user = await createTestOfficeUser()
  createdOffices.push(user.officeId)
  return user
}

async function seedCases(officeId: string, ownerId: string, clientId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await prisma.case.create({
      data: { number: `PG-${officeId.slice(-6)}-${i}`, title: `Case ${i}`, type: 'مدني', officeId, clientId, ownerId },
    })
    await new Promise((r) => setTimeout(r, 3)) // distinct createdAt so ordering is meaningfully exercised
  }
}

describe('cursor pagination — first/next/final page', () => {
  it('walks through every page with no duplicates and no gaps', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Pagination Client', officeId: user.officeId, ownerId: user.id } })
    await seedCases(user.officeId, user.id, client.id, 7)

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    let sawFinalPage = false

    for (let i = 0; i < 20; i++) {
      const url = cursor ? `/api/cases?limit=3&cursor=${encodeURIComponent(cursor)}` : '/api/cases?limit=3'
      const res = await listCases(testRequest(url, { user }))
      const page = await readJson(res)
      pages++
      seen.push(...page.map((c: { id: string }) => c.id))

      const hasMore = res.headers.get('X-Has-More')
      if (hasMore === 'false') { sawFinalPage = true; expect(res.headers.get('X-Next-Cursor')).toBeNull(); break }
      cursor = res.headers.get('X-Next-Cursor')
      expect(cursor).toBeTruthy()
    }

    expect(sawFinalPage).toBe(true)
    expect(pages).toBe(3) // 7 items at limit=3 -> pages of 3, 3, 1
    expect(new Set(seen).size).toBe(seen.length) // no duplicates
    expect(seen.length).toBe(7) // no gaps
  })

  it('the first page reports the total count; later pages do not recompute it', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Total Count Client', officeId: user.officeId, ownerId: user.id } })
    await seedCases(user.officeId, user.id, client.id, 4)

    const firstPage = await listCases(testRequest('/api/cases?limit=2', { user }))
    expect(firstPage.headers.get('X-Total-Count')).toBe('4')

    const cursor = firstPage.headers.get('X-Next-Cursor')
    const secondPage = await listCases(testRequest(`/api/cases?limit=2&cursor=${encodeURIComponent(cursor!)}`, { user }))
    expect(secondPage.headers.get('X-Total-Count')).toBeNull()
  })
})

describe('cursor pagination — maximum page size', () => {
  it('clamps an oversized limit to the server-side maximum instead of honoring it', async () => {
    const user = await trackedUser()
    const client = await prisma.client.create({ data: { name: 'Cap Client', officeId: user.officeId, ownerId: user.id } })
    await seedCases(user.officeId, user.id, client.id, 3) // fewer than the cap, so this proves the cap doesn't error, not that it truncates

    const res = await listCases(testRequest('/api/cases?limit=999999', { user }))
    expect(res.status).toBe(200)
    const page = await readJson(res)
    expect(page.length).toBe(3)
  })
})

describe('cursor pagination — invalid values', () => {
  it('rejects a non-numeric limit with 400', async () => {
    const user = await trackedUser()
    const res = await listCases(testRequest('/api/cases?limit=not-a-number', { user }))
    expect(res.status).toBe(400)
  })

  it('rejects a negative limit with 400', async () => {
    const user = await trackedUser()
    const res = await listCases(testRequest('/api/cases?limit=-5', { user }))
    expect(res.status).toBe(400)
  })

  it('rejects a garbage cursor with 400', async () => {
    const user = await trackedUser()
    const res = await listCases(testRequest('/api/cases?cursor=not-a-real-cursor', { user }))
    expect(res.status).toBe(400)
  })
})

describe('cursor pagination — tenant isolation across pages', () => {
  it('never returns another office\'s records on any page', async () => {
    const officeA = await trackedUser()
    const officeB = await trackedUser()
    const clientA = await prisma.client.create({ data: { name: 'A', officeId: officeA.officeId, ownerId: officeA.id } })
    const clientB = await prisma.client.create({ data: { name: 'B', officeId: officeB.officeId, ownerId: officeB.id } })
    await seedCases(officeA.officeId, officeA.id, clientA.id, 5)
    await seedCases(officeB.officeId, officeB.id, clientB.id, 5)

    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const url = cursor ? `/api/cases?limit=2&cursor=${encodeURIComponent(cursor)}` : '/api/cases?limit=2'
      const res = await listCases(testRequest(url, { user: officeA }))
      const page = await readJson(res)
      expect(page.every((c: { officeId: string }) => c.officeId === officeA.officeId)).toBe(true)

      if (res.headers.get('X-Has-More') === 'false') break
      cursor = res.headers.get('X-Next-Cursor')
    }
  })
})
