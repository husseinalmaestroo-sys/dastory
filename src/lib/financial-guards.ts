import { Prisma, type InvoiceStatus } from '@prisma/client'

// Guards against destroying or silently rewriting financial/billing records.
// Kept as pure functions so every decision is unit-testable without a
// database — the routes fetch the relevant fields and call these, then
// apply the write conditionally (see src/app/api/invoices/[id]/route.ts).

export type DeletionGuardResult = { allowed: true } | { allowed: false; reason: string }

type Money = Prisma.Decimal | number

function dec(value: Money): Prisma.Decimal {
  return Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal) : new Prisma.Decimal(value)
}

/**
 * True once money has ever been recorded against the invoice. Uses
 * `paymentRecordedAt`, which is set on the first payment and never cleared —
 * so resetting `paid` back to 0 does not make the invoice look unpaid.
 */
export function hasRecordedPayment(invoice: { paid: Money; status: string; paymentRecordedAt?: Date | null }): boolean {
  return Boolean(invoice.paymentRecordedAt) || dec(invoice.paid).gt(0) || invoice.status === 'PAID'
}

/**
 * An invoice with money ever recorded against it is a financial record, not
 * a draft, and can't be deleted by anyone. Before `paymentRecordedAt`
 * existed, "PATCH paid:0 → DELETE" turned a paid invoice back into a
 * deletable draft in two requests.
 */
export function invoiceDeletionGuard(invoice: { paid: Money; status: string; paymentRecordedAt?: Date | null }): DeletionGuardResult {
  if (hasRecordedPayment(invoice)) return { allowed: false, reason: 'has_payment' }
  return { allowed: true }
}

/**
 * The invoice status implied by its amounts. Status is derived rather than
 * trusted, so it can't contradict the money (e.g. "PAID" with nothing paid):
 *   paid ≥ amount → PAID
 *   OVERDUE, if requested, while not fully paid
 *   0 < paid < amount → PARTIAL; paid = 0 → UNPAID
 * Asking for PAID without the full amount paid is an error, not a silent
 * rewrite of the amount the user entered.
 */
export function resolveInvoiceStatus(
  amount: Money,
  paid: Money,
  requested?: InvoiceStatus
): { ok: true; status: InvoiceStatus } | { ok: false; error: string } {
  const a = dec(amount)
  const p = dec(paid)
  if (p.gt(a)) return { ok: false, error: 'المبلغ المدفوع لا يمكن أن يتجاوز مبلغ الفاتورة' }
  if (p.gte(a)) return { ok: true, status: 'PAID' }
  if (requested === 'PAID') {
    return { ok: false, error: 'لتعليم الفاتورة كمدفوعة أدخل المبلغ المدفوع كاملاً' }
  }
  if (requested === 'OVERDUE') return { ok: true, status: 'OVERDUE' }
  return { ok: true, status: p.gt(0) ? 'PARTIAL' : 'UNPAID' }
}

/**
 * Once a payment is recorded, lowering the recorded payment or the invoice
 * amount is a correction of a financial record: office managers only (and
 * the route audit-logs old → new values). Raising either is ordinary use.
 */
export function paymentCorrectionGuard(
  before: { amount: Money; paid: Money; status: string; paymentRecordedAt?: Date | null },
  after: { amount: Money; paid: Money },
  isManager: boolean
): DeletionGuardResult {
  if (!hasRecordedPayment(before)) return { allowed: true }
  const lowersPaid = dec(after.paid).lt(dec(before.paid))
  const lowersAmount = dec(after.amount).lt(dec(before.amount))
  if ((lowersPaid || lowersAmount) && !isManager) return { allowed: false, reason: 'payment_correction_requires_manager' }
  return { allowed: true }
}

/**
 * A time entry marked `invoiced` is the billing justification behind an
 * invoice already sent — deleting it erases that trail. Un-invoiced
 * entries (drafts, corrections before billing) may still be deleted.
 */
export function timeEntryDeletionGuard(entry: { invoiced: boolean }): DeletionGuardResult {
  if (entry.invoiced) {
    return { allowed: false, reason: 'already_invoiced' }
  }
  return { allowed: true }
}
