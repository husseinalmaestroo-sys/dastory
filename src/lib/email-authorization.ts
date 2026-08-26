import type { Role } from '@prisma/client'

// Decides whether an office user may send an outbound email (via the
// office's shared SMTP credentials) to `to`. Kept as a pure function so it
// can be unit tested without a database — the route handler is responsible
// for fetching `candidates` (already tenant-scoped) and for the actual send.
//
// Business model: the in-app email relay exists so staff can message people
// already connected to their work (clients, or colleagues in the same
// office) — not as a general-purpose mailer to arbitrary external
// addresses. OFFICE_MANAGER is the one role trusted to email outside that
// set, mirroring the elevated trust it already has elsewhere (staff
// management, billing) rather than adding a separate approval-queue feature.

export type EmailAuthUser = {
  role: Role
  officeId: string
}

export type EmailAuthCandidates = {
  /** A client visible to the sender (tenant/ownership-scoped query result), matched by email. */
  matchedClient?: { officeId: string; email: string | null } | null
  /** A colleague (staff user) in the sender's office, matched by email. */
  matchedColleague?: { officeId: string; email: string } | null
}

export type EmailAuthResult =
  | { allowed: true; reason: 'client_recipient' | 'colleague_recipient' | 'manager_override' }
  | { allowed: false; reason: 'citizen_role_not_permitted' | 'recipient_not_associated' }

export function resolveEmailAuthorization(user: EmailAuthUser, candidates: EmailAuthCandidates): EmailAuthResult {
  // Defense in depth: requireOfficeUser already excludes CITIZEN before this
  // is ever called, but this function should independently deny it too.
  if (user.role === 'CITIZEN') {
    return { allowed: false, reason: 'citizen_role_not_permitted' }
  }

  // Re-check office match here too — even though the caller's Prisma query
  // should already be tenant-scoped, this keeps the decision itself correct
  // if it's ever called with unscoped/incorrectly-scoped candidates.
  if (candidates.matchedClient && candidates.matchedClient.officeId === user.officeId) {
    return { allowed: true, reason: 'client_recipient' }
  }

  if (candidates.matchedColleague && candidates.matchedColleague.officeId === user.officeId) {
    return { allowed: true, reason: 'colleague_recipient' }
  }

  if (user.role === 'OFFICE_MANAGER') {
    return { allowed: true, reason: 'manager_override' }
  }

  return { allowed: false, reason: 'recipient_not_associated' }
}
