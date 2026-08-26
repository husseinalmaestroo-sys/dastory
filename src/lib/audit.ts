import type { NextRequest } from 'next/server'
import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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

export function getRequestIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
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
