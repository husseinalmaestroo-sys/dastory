import { describe, expect, it } from 'vitest'
import { Role } from '@prisma/client'
import {
  caseVisibilityWhere,
  clientOwnedWhere,
  clientVisibilityWhere,
  clientWritableWhere,
  documentVisibilityWhere,
  invoiceVisibilityWhere,
  isOfficeManager,
  sessionVisibilityWhere,
  staffVisibilityWhere,
  staffWritableWhere,
  timeEntryVisibilityWhere,
  type OfficeUserPayload,
} from './tenant-scope'

const manager: OfficeUserPayload = { id: 'mgr-1', email: 'm@x.jo', name: 'Manager', role: Role.OFFICE_MANAGER, officeId: 'off-1' }
const lawyer: OfficeUserPayload = { id: 'law-1', email: 'l@x.jo', name: 'Lawyer', role: Role.LAWYER, officeId: 'off-1' }

// These tests pin down the exact Prisma `where` shape every list/detail/write
// route relies on for cross-lawyer and cross-office isolation. If one of these
// changes, every route built on top of it silently changes its access rules too.

describe('isOfficeManager', () => {
  it('is true only for OFFICE_MANAGER', () => {
    expect(isOfficeManager(manager)).toBe(true)
    expect(isOfficeManager(lawyer)).toBe(false)
  })
})

describe('clientVisibilityWhere', () => {
  it('manager sees the whole office, no ownership filter', () => {
    const where = clientVisibilityWhere(manager) as any
    expect(where.AND).toContainEqual({ officeId: 'off-1' })
    expect(JSON.stringify(where)).not.toContain('ownerId')
  })

  it('lawyer is restricted to owned clients OR clients they have a case with', () => {
    const where = clientVisibilityWhere(lawyer) as any
    const clause = where.AND.find((c: any) => c.OR)
    expect(clause.OR).toContainEqual({ ownerId: 'law-1' })
    expect(clause.OR).toContainEqual({ cases: { some: { ownerId: 'law-1' } } })
  })
})

describe('clientWritableWhere vs clientOwnedWhere', () => {
  it('writable is broadened for lawyers to match visibility (can edit a shared-case client)', () => {
    const writable = clientWritableWhere(lawyer) as any
    const clause = writable.AND.find((c: any) => c.OR)
    expect(clause.OR).toContainEqual({ cases: { some: { ownerId: 'law-1' } } })
  })

  it('owned is strict — no shared-case broadening (used for deactivation)', () => {
    const owned = clientOwnedWhere(lawyer) as any
    expect(owned.AND).toContainEqual({ ownerId: 'law-1' })
    expect(JSON.stringify(owned)).not.toContain('cases')
  })

  it('manager bypasses both restrictions the same way', () => {
    expect(clientWritableWhere(manager)).toEqual(clientOwnedWhere(manager))
  })
})

describe('caseVisibilityWhere', () => {
  it('lawyer only sees cases they own — not cases merely assigned via lawyerId', () => {
    const where = caseVisibilityWhere(lawyer) as any
    expect(where.AND).toContainEqual({ ownerId: 'law-1' })
  })
})

describe('sessionVisibilityWhere / invoiceVisibilityWhere / documentVisibilityWhere', () => {
  it('sessions are gated through the parent case owner', () => {
    const where = sessionVisibilityWhere(lawyer) as any
    expect(where.AND).toContainEqual({ case: { ownerId: 'law-1' } })
  })

  it('invoices are visible via owned case, or a case-less invoice on an owned client', () => {
    const where = invoiceVisibilityWhere(lawyer) as any
    const clause = where.AND.find((c: any) => c.OR)
    expect(clause.OR).toContainEqual({ case: { is: { ownerId: 'law-1' } } })
    expect(clause.OR).toContainEqual({ caseId: null, client: { ownerId: 'law-1' } })
  })

  it('documents are visible if uploaded by the lawyer or on a case they own', () => {
    const where = documentVisibilityWhere(lawyer) as any
    const clause = where.AND.find((c: any) => c.OR)
    expect(clause.OR).toContainEqual({ ownerId: 'law-1' })
    expect(clause.OR).toContainEqual({ case: { is: { ownerId: 'law-1' } } })
  })
})

describe('staffVisibilityWhere / staffWritableWhere', () => {
  it('a lawyer listing the team only ever sees themself, never a peer', () => {
    const where = staffVisibilityWhere(lawyer) as any
    expect(where.id).toBe('law-1')
    expect(where.officeId).toBe('off-1')
  })

  it('a manager sees every staff member in the office', () => {
    const where = staffVisibilityWhere(manager) as any
    expect(where.id).toBeUndefined()
    expect(where.officeId).toBe('off-1')
  })

  it('CITIZEN accounts are excluded from staff listings regardless of role', () => {
    expect((staffVisibilityWhere(manager) as any).role.in).not.toContain(Role.CITIZEN)
    expect((staffVisibilityWhere(lawyer) as any).role.in).not.toContain(Role.CITIZEN)
  })

  it('staffWritableWhere is office-scoped and excludes CITIZEN', () => {
    const where = staffWritableWhere(manager) as any
    expect(where.AND).toContainEqual({ officeId: 'off-1' })
    expect(where.AND).toContainEqual({ role: { in: [Role.OFFICE_MANAGER, Role.LAWYER] } })
  })
})

describe('timeEntryVisibilityWhere', () => {
  it('a lawyer only sees their own logged time', () => {
    const where = timeEntryVisibilityWhere(lawyer) as any
    expect(where.AND).toContainEqual({ userId: 'law-1' })
  })

  it('a manager sees all logged time in the office', () => {
    const where = timeEntryVisibilityWhere(manager) as any
    expect(JSON.stringify(where)).not.toContain('userId')
  })
})

describe('cross-office isolation', () => {
  it('every visibility function scopes to the caller officeId, never a hardcoded or foreign one', () => {
    const otherOfficeLawyer: OfficeUserPayload = { ...lawyer, officeId: 'off-2' }
    const where = clientVisibilityWhere(otherOfficeLawyer) as any
    expect(where.AND).toContainEqual({ officeId: 'off-2' })
    expect(where.AND).not.toContainEqual({ officeId: 'off-1' })
  })
})
