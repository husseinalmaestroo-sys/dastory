import { describe, expect, it } from 'vitest'
import { invoiceDeletionGuard, timeEntryDeletionGuard } from './financial-guards'

describe('invoiceDeletionGuard', () => {
  it('blocks deletion of a fully paid invoice', () => {
    const result = invoiceDeletionGuard({ paid: 500, status: 'PAID' })
    expect(result).toEqual({ allowed: false, reason: 'has_payment' })
  })

  it('blocks deletion of a partially paid invoice', () => {
    const result = invoiceDeletionGuard({ paid: 100, status: 'PARTIAL' })
    expect(result).toEqual({ allowed: false, reason: 'has_payment' })
  })

  it('blocks an invoice marked PAID even if paid happens to read 0 (data inconsistency safety net)', () => {
    const result = invoiceDeletionGuard({ paid: 0, status: 'PAID' })
    expect(result.allowed).toBe(false)
  })

  it('allows deletion of an unpaid draft invoice', () => {
    const result = invoiceDeletionGuard({ paid: 0, status: 'UNPAID' })
    expect(result).toEqual({ allowed: true })
  })

  it('allows deletion of an overdue invoice with nothing paid', () => {
    const result = invoiceDeletionGuard({ paid: 0, status: 'OVERDUE' })
    expect(result).toEqual({ allowed: true })
  })
})

describe('timeEntryDeletionGuard', () => {
  it('blocks deletion of an already-invoiced time entry', () => {
    expect(timeEntryDeletionGuard({ invoiced: true })).toEqual({ allowed: false, reason: 'already_invoiced' })
  })

  it('allows deletion of a not-yet-invoiced time entry', () => {
    expect(timeEntryDeletionGuard({ invoiced: false })).toEqual({ allowed: true })
  })
})
