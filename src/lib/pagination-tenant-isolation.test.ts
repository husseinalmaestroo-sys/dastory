import { describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import { caseVisibilityWhere, invoiceVisibilityWhere, type OfficeUserPayload } from './tenant-scope'
import { combineWhere, cursorWhereClause } from './pagination'

// Regression coverage for "tenant isolation across pages": proves that
// composing a cursor clause (as every paginated route does via
// combineWhere(tenantScopeWhere, cursorWhereClause(...))) never loses or
// replaces the tenant/ownership scoping — the classic risk with naive
// object-spread merging of two `where` fragments that both use `OR`.

const officeA: OfficeUserPayload = { id: 'law-a', email: 'a@x.jo', name: 'A', role: Role.LAWYER, officeId: 'off-A' }
const officeB: OfficeUserPayload = { id: 'law-b', email: 'b@x.jo', name: 'B', role: Role.LAWYER, officeId: 'off-B' }

function findOfficeIdClauses(where: unknown): string[] {
  const found: string[] = []
  function walk(node: unknown) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      if (typeof obj.officeId === 'string') found.push(obj.officeId)
      Object.values(obj).forEach(walk)
    }
  }
  walk(where)
  return found
}

describe('pagination + tenant isolation composition', () => {
  it('a cursor on a case list still scopes to the requesting office only', () => {
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'case-old' }
    const where = caseVisibilityWhere(officeA, cursorWhereClause('createdAt', 'desc', cursor) as never)

    const officeIds = findOfficeIdClauses(where)
    expect(officeIds).toContain('off-A')
    expect(officeIds).not.toContain('off-B')
  })

  it('two different offices paginating the same cursor position get differently-scoped queries', () => {
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'case-old' }
    const whereA = caseVisibilityWhere(officeA, cursorWhereClause('createdAt', 'desc', cursor) as never)
    const whereB = caseVisibilityWhere(officeB, cursorWhereClause('createdAt', 'desc', cursor) as never)

    expect(findOfficeIdClauses(whereA)).toEqual(['off-A'])
    expect(findOfficeIdClauses(whereB)).toEqual(['off-B'])
    expect(whereA).not.toEqual(whereB)
  })

  it('combining a search filter (OR) with a cursor filter (OR) keeps the tenant scope, not just one OR branch', () => {
    // invoiceVisibilityWhere itself produces an OR (case-owner or caseless-client-owner)
    // for a non-manager user — combining it with the cursor's own OR is exactly the
    // object-spread collision this whole utility exists to avoid.
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'inv-old' }
    const where = invoiceVisibilityWhere(officeA, cursorWhereClause('createdAt', 'desc', cursor) as never) as { AND: unknown[] }

    // The office scope must still be present...
    expect(findOfficeIdClauses(where)).toEqual(['off-A'])
    // ...and the ownership OR clause must still be present alongside the cursor OR —
    // neither should have silently overwritten the other.
    const serialized = JSON.stringify(where)
    expect(serialized).toContain('ownerId')
    expect(serialized).toContain('inv-old')
  })

  it('a manager (office-wide access) is still scoped to their own office when paginating', () => {
    const manager: OfficeUserPayload = { id: 'mgr-a', email: 'm@x.jo', name: 'M', role: Role.OFFICE_MANAGER, officeId: 'off-A' }
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'case-old' }
    const where = caseVisibilityWhere(manager, cursorWhereClause('createdAt', 'desc', cursor) as never)
    expect(findOfficeIdClauses(where)).toEqual(['off-A'])
  })

  it('the first page (no cursor) and a later page (with cursor) scope to the same office identically', () => {
    const firstPage = caseVisibilityWhere(officeA, cursorWhereClause('createdAt', 'desc', null) as never)
    const laterPage = caseVisibilityWhere(officeA, cursorWhereClause('createdAt', 'desc', { value: '2026-01-01T00:00:00.000Z', id: 'x' }) as never)
    expect(findOfficeIdClauses(firstPage)).toEqual(['off-A'])
    expect(findOfficeIdClauses(laterPage)).toEqual(['off-A'])
  })
})

describe('combineWhere never drops a tenant scope key', () => {
  it('officeId survives being combined with both a search OR and a cursor OR', () => {
    const tenantScope = { officeId: 'off-A' }
    const searchOr = { OR: [{ name: { contains: 'ali' } }] }
    const cursorOr = { OR: [{ createdAt: { lt: new Date('2026-01-01') } }] }
    const combined = combineWhere(tenantScope, searchOr, cursorOr) as { AND: Record<string, unknown>[] }
    expect(combined.AND).toContainEqual(tenantScope)
    expect(combined.AND).toContainEqual(searchOr)
    expect(combined.AND).toContainEqual(cursorOr)
  })
})
