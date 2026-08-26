import { Prisma, Role } from '@prisma/client'
import type { JWTPayload } from '@/lib/jwt'

export type OfficeUserPayload = JWTPayload & { officeId: string }

export function isOfficeManager(user: Pick<JWTPayload, 'role'>) {
  return user.role === Role.OFFICE_MANAGER
}

function andWhere<T>(...parts: T[]): { AND: T[] } {
  return { AND: parts }
}

export function clientVisibilityWhere(user: OfficeUserPayload, extra: Prisma.ClientWhereInput = {}): Prisma.ClientWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere(
    { officeId: user.officeId },
    extra,
    {
      OR: [
        { ownerId: user.id },
        { cases: { some: { ownerId: user.id } } },
      ],
    }
  )
}

export function clientWritableWhere(user: OfficeUserPayload, extra: Prisma.ClientWhereInput = {}): Prisma.ClientWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere(
    { officeId: user.officeId },
    extra,
    {
      OR: [
        { ownerId: user.id },
        { cases: { some: { ownerId: user.id } } },
      ],
    }
  )
}

// Stricter than clientWritableWhere: only the direct owner (or the manager) may
// deactivate a client, since that hides it office-wide — including for other
// lawyers who may hold their own case with the same client.
export function clientOwnedWhere(user: OfficeUserPayload, extra: Prisma.ClientWhereInput = {}): Prisma.ClientWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere({ officeId: user.officeId }, extra, { ownerId: user.id })
}

export function caseVisibilityWhere(user: OfficeUserPayload, extra: Prisma.CaseWhereInput = {}): Prisma.CaseWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere({ officeId: user.officeId }, extra, { ownerId: user.id })
}

export function sessionVisibilityWhere(user: OfficeUserPayload, extra: Prisma.SessionWhereInput = {}): Prisma.SessionWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere({ officeId: user.officeId }, extra, { case: { ownerId: user.id } })
}

export function invoiceVisibilityWhere(user: OfficeUserPayload, extra: Prisma.InvoiceWhereInput = {}): Prisma.InvoiceWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere(
    { officeId: user.officeId },
    extra,
    {
      OR: [
        { case: { is: { ownerId: user.id } } },
        { caseId: null, client: { ownerId: user.id } },
      ],
    }
  )
}

export function documentVisibilityWhere(user: OfficeUserPayload, extra: Prisma.DocumentWhereInput = {}): Prisma.DocumentWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere(
    { officeId: user.officeId },
    extra,
    {
      OR: [
        { ownerId: user.id },
        { case: { is: { ownerId: user.id } } },
      ],
    }
  )
}

export function staffVisibilityWhere(user: OfficeUserPayload): Prisma.UserWhereInput {
  const staff = { role: { in: [Role.OFFICE_MANAGER, Role.LAWYER] } }
  if (isOfficeManager(user)) return { officeId: user.officeId, ...staff }
  return { officeId: user.officeId, id: user.id, ...staff }
}

export function staffWritableWhere(user: OfficeUserPayload, extra: Prisma.UserWhereInput = {}): Prisma.UserWhereInput {
  return andWhere(
    { officeId: user.officeId },
    { role: { in: [Role.OFFICE_MANAGER, Role.LAWYER] } },
    extra
  )
}

export function timeEntryVisibilityWhere(user: OfficeUserPayload, extra: Prisma.TimeEntryWhereInput = {}): Prisma.TimeEntryWhereInput {
  if (isOfficeManager(user)) return andWhere({ officeId: user.officeId }, extra)
  return andWhere({ officeId: user.officeId }, extra, { userId: user.id })
}
