// Guards against destroying financial/billing records via direct deletion.
// Kept as pure functions so the decision is unit-testable without a
// database — the routes just fetch the relevant fields and call these.

export type DeletionGuardResult = { allowed: true } | { allowed: false; reason: string }

/**
 * An invoice with money collected against it (paid > 0, or explicitly
 * marked PAID) is a financial record, not a draft. Unpaid invoices have no
 * such record to lose and may still be deleted.
 */
export function invoiceDeletionGuard(invoice: { paid: number; status: string }): DeletionGuardResult {
  if (invoice.paid > 0 || invoice.status === 'PAID') {
    return { allowed: false, reason: 'has_payment' }
  }
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
