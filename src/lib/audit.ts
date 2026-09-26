import type { NextRequest } from 'next/server'
import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getClientIp } from '@/lib/api-security'

type AuditActor = {
  id?: string | null
  email?: string | null
  role?: Role | null
  officeId?: string | null
}

type AuditDetails = {
  actorEmail?: string | null
  officeId?: string | null
  entityType?: string
  entityId?: string | null
  metadata?: Prisma.InputJsonValue
}

/**
 * The client IP recorded in audit logs and signature records. Same trusted-
 * proxy logic as rate limiting (getClientIp): the FIRST X-Forwarded-For entry
 * used to be taken here, which is exactly the part a client writes itself,
 * so audit trails could be made to show any IP an attacker liked.
 */
export function getRequestIp(req: NextRequest) {
  return getClientIp(req)
}

export async function auditLog(
  req: NextRequest,
  actor: AuditActor | null,
  action: string,
  details: AuditDetails = {}
) {
  try {
    await prisma.auditLog.create({
      data: {
        officeId: details.officeId ?? actor?.officeId ?? null,
        actorId: actor?.id ?? null,
        actorEmail: actor?.email ?? details.actorEmail ?? null,
        actorRole: actor?.role ?? null,
        action,
        entityType: details.entityType,
        entityId: details.entityId ?? null,
        ipAddress: getRequestIp(req),
        userAgent: req.headers.get('user-agent'),
        metadata: details.metadata,
      },
    })
  } catch (error) {
    console.error('auditLog failed', error)
  }
}
