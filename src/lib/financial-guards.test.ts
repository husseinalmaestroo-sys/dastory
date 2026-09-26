import { describe, expect, it } from 'vitest'
import { invoiceDeletionGuard, timeEntryDeletionGuard } from './financial-guards'
import { hasRecordedPayment, paymentCorrectionGuard, resolveInvoiceStatus } from './financial-guards'

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


describe('hasRecordedPayment — survives a reset of `paid`', () => {
  it('is true once paymentRecordedAt is set, even with paid back at 0', () => {
    expect(hasRecordedPayment({ paid: 0, status: 'UNPAID', paymentRecordedAt: new Date() })).toBe(true)
    expect(invoiceDeletionGuard({ paid: 0, status: 'UNPAID', paymentRecordedAt: new Date() }).allowed).toBe(false)
  })
  it('is false for an invoice that never had a payment', () => {
    expect(hasRecordedPayment({ paid: 0, status: 'OVERDUE', paymentRecordedAt: null })).toBe(false)
  })
})

describe('resolveInvoiceStatus — status follows the money', () => {
  it.each([
    [100, 0, undefined, 'UNPAID'], [100, 40, undefined, 'PARTIAL'], [100, 100, undefined, 'PAID'],
    [100, 100, 'UNPAID', 'PAID'], [100, 0, 'OVERDUE', 'OVERDUE'], [100, 40, 'OVERDUE', 'OVERDUE'],
  ] as const)('amount %s, paid %s, requested %s -> %s', (amount, paid, requested, expected) => {
    const r = resolveInvoiceStatus(amount, paid, requested)
    expect(r.ok && r.status).toBe(expected)
  })
  it('rejects PAID without full payment, and paid above amount', () => {
    expect(resolveInvoiceStatus(100, 10, 'PAID').ok).toBe(false)
    expect(resolveInvoiceStatus(100, 101).ok).toBe(false)
  })
})

describe('paymentCorrectionGuard', () => {
  const paid = { amount: 100, paid: 100, status: 'PAID', paymentRecordedAt: new Date() }
  it('lets anyone raise amounts, but only a manager lower a recorded payment or amount', () => {
    expect(paymentCorrectionGuard(paid, { amount: 120, paid: 100 }, false).allowed).toBe(true)
    expect(paymentCorrectionGuard(paid, { amount: 100, paid: 0 }, false).allowed).toBe(false)
    expect(paymentCorrectionGuard(paid, { amount: 90, paid: 90 }, false).allowed).toBe(false)
    expect(paymentCorrectionGuard(paid, { amount: 100, paid: 0 }, true).allowed).toBe(true)
  })
  it('does not restrict invoices without a recorded payment', () => {
    expect(paymentCorrectionGuard({ amount: 100, paid: 0, status: 'UNPAID', paymentRecordedAt: null }, { amount: 10, paid: 0 }, false).allowed).toBe(true)
  })
})
