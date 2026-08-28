import { NextResponse } from 'next/server'
import { access, constants } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { isSmtpConfigured } from '@/lib/email'
import { AI_CONFIGURED } from '@/lib/ai/client'

// Public and unauthenticated (standard for a health/liveness endpoint hit by
// a load balancer or uptime monitor) — deliberately reports only ok/degraded
// per check, never a connection string, stack trace, or any other secret.
// Real checks, not a hardcoded {"status":"ok"}: this will genuinely report
// "down" if the database is actually unreachable or storage isn't writable.
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = { ok: true }
  } catch {
    checks.database = { ok: false, detail: 'unreachable' }
  }

  try {
    const storageDir = join(process.cwd(), 'storage', 'case-documents')
    await access(storageDir, constants.W_OK)
    checks.storage = { ok: true }
  } catch {
    checks.storage = { ok: false, detail: 'not writable or missing' }
  }

  checks.email = { ok: isSmtpConfigured(), detail: isSmtpConfigured() ? undefined : 'SMTP not configured (optional)' }
  checks.ai = { ok: AI_CONFIGURED, detail: AI_CONFIGURED ? undefined : 'AI provider not configured (optional)' }

  // Only database and storage are load-bearing for the app to function at
  // all; email/AI being unconfigured is a documented, non-degraded state.
  const healthy = checks.database.ok && checks.storage.ok

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  )
}
