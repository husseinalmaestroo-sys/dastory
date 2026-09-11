// 10-firm pilot security audit — Section 5 ("Test concurrent editing by the
// two lawyers... check for data loss, overwriting, race conditions, stale
// data, duplicate records").
//
// Finding this test exists to make explicit rather than assume: PATCH
// /api/cases/[id] (cases/[id]/route.ts) has no optimistic lock — no version
// column, no If-Match/updatedAt check. It IS a sparse update (only the
// fields present in the request body are written), which is materially
// better than a naive full-record PUT: two people editing DIFFERENT fields
// of the same case at the same time do not clobber each other. Two people
// editing the SAME field at the same time is a genuine last-write-wins race
// — no corruption, no crash, no duplicate row, but no conflict warning to
// either side either. That is the actual, current behavior asserted below,
// not a hypothesis.
//
// Fixture note: a non-manager lawyer can only write a case they OWN
// (caseVisibilityWhere in tenant-scope.ts, already covered by
// tenant-isolation.integration.test.ts's "a lawyer only sees cases they own"
// test) — a colleague's case correctly 404s for them, which is by design,
// not a race condition. So the case below is owned by the lawyer, and the
// manager (who can write any case office-wide) is the second concurrent
// editor — the actual pair of roles that can legitimately both touch one
// case at once in this permission model.
import { afterEach, describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PATCH as casePatch } from '@/app/api/cases/[id]/route'
import { cleanupOffice, createColleague, createTestOfficeUser, testParams, testRequest } from './helpers'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

async function makeOwnedCase(number: string) {
  const manager = await createTestOfficeUser({ role: Role.OFFICE_MANAGER })
  createdOffices.push(manager.officeId)
  const lawyer = await createColleague(manager.officeId, { role: Role.LAWYER })
  const client = await prisma.client.create({ data: { name: `${number} client`, officeId: manager.officeId, ownerId: lawyer.id } })
  const kase = await prisma.case.create({
    data: { number, title: 'Original title', type: 'مدني', officeId: manager.officeId, clientId: client.id, ownerId: lawyer.id },
  })
  return { manager, lawyer, kase }
}

describe('concurrent case editing — a manager and the owning lawyer both hold legitimate write access', () => {
  it('patching DIFFERENT fields at the same time: both changes land (sparse update, no clobbering)', async () => {
    const { manager, lawyer, kase } = await makeOwnedCase('RACE-1')

    const [resA, resB] = await Promise.all([
      casePatch(testRequest(`/api/cases/${kase.id}`, { method: 'PATCH', user: manager, body: { status: 'CLOSED' } }), testParams({ id: kase.id })),
      casePatch(testRequest(`/api/cases/${kase.id}`, { method: 'PATCH', user: lawyer, body: { notes: 'Lawyer\'s concurrent note' } }), testParams({ id: kase.id })),
    ])
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const final = await prisma.case.findUnique({ where: { id: kase.id } })
    expect(final?.status).toBe('CLOSED')
    expect(final?.notes).toBe('Lawyer\'s concurrent note')

    const rowCount = await prisma.case.count({ where: { id: kase.id } })
    expect(rowCount).toBe(1) // no duplicate row from the race
  })

  it('patching the SAME field at the same time: last write wins cleanly — no crash, no corrupted/merged value, no duplicate row', async () => {
    const { manager, lawyer, kase } = await makeOwnedCase('RACE-2')

    const [resA, resB] = await Promise.all([
      casePatch(testRequest(`/api/cases/${kase.id}`, { method: 'PATCH', user: manager, body: { notes: 'Manager\'s version' } }), testParams({ id: kase.id })),
      casePatch(testRequest(`/api/cases/${kase.id}`, { method: 'PATCH', user: lawyer, body: { notes: 'Lawyer\'s version' } }), testParams({ id: kase.id })),
    ])
    // Neither request errors — both are individually valid writes; whichever
    // commits last in the DB determines the final value.
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)

    const final = await prisma.case.findUnique({ where: { id: kase.id } })
    expect(['Manager\'s version', 'Lawyer\'s version']).toContain(final?.notes)

    const rowCount = await prisma.case.count({ where: { id: kase.id } })
    expect(rowCount).toBe(1)

    // Documented gap, not a crash: whichever side's write lost has no way to
    // know from its own 200 response that the note was overwritten moments
    // later. No optimistic-lock / conflict signal exists today.
  })

  it('10 concurrent PATCHes to the same case (stress form of the race) never produce more than one row nor a server error', async () => {
    const { manager, kase } = await makeOwnedCase('RACE-3')

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        casePatch(testRequest(`/api/cases/${kase.id}`, { method: 'PATCH', user: manager, body: { notes: `write #${i}` } }), testParams({ id: kase.id }))
      )
    )
    expect(results.every((r) => r.status === 200)).toBe(true)

    const rowCount = await prisma.case.count({ where: { id: kase.id } })
    expect(rowCount).toBe(1)
    const final = await prisma.case.findUnique({ where: { id: kase.id } })
    expect(final?.notes).toMatch(/^write #\d$/) // one of the ten writes won cleanly, not a merge of several
  })
})
