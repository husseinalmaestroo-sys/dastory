import type { Prisma } from '@prisma/client'

// The client (CITIZEN) portal's field allow-lists — the single definition of
// what a law firm's client may see about their own matters. Everything not
// listed is internal staff data and must never reach a citizen response,
// even though the same database rows carry it. In particular:
//   Case:    notes (lawyers' internal notes), ownerId, lawyerId, officeId, clientId
//   Session: notes, judge
//   Invoice: notes, officeId, clientId, caseId, paymentRecordedAt
// The citizen routes previously used `include`, which returns every scalar
// column — internal case/session/invoice notes included.
// Tests: src/__integration__/citizen-confidentiality.integration.test.ts
// fails if any response carries a key outside these lists.

export const CITIZEN_CASE_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  court: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lawyer: { select: { name: true } },
  sessions: {
    where: { status: 'UPCOMING' },
    select: { id: true, date: true, time: true, court: true, status: true },
    orderBy: { date: 'asc' },
    take: 3,
  },
  _count: { select: { sessions: true, documents: true } },
} satisfies Prisma.CaseSelect

export const CITIZEN_SESSION_SELECT = {
  id: true,
  date: true,
  time: true,
  court: true,
  status: true,
  case: { select: { number: true, title: true } },
} satisfies Prisma.SessionSelect

export const CITIZEN_INVOICE_SELECT = {
  id: true,
  number: true,
  amount: true,
  paid: true,
  status: true,
  dueDate: true,
  createdAt: true,
  case: { select: { number: true, title: true } },
} satisfies Prisma.InvoiceSelect

/** Top-level keys a citizen response object may carry, per resource — used by tests. */
export const CITIZEN_ALLOWED_KEYS = {
  case: ['id', 'number', 'title', 'type', 'court', 'status', 'createdAt', 'updatedAt', 'lawyer', 'sessions', '_count'],
  session: ['id', 'date', 'time', 'court', 'status', 'case'],
  invoice: ['id', 'number', 'amount', 'paid', 'status', 'dueDate', 'createdAt', 'case'],
} as const
