import { NextResponse } from 'next/server'
import { access, constants } from 'fs/promises'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { missingOcrModels } from '@/lib/ai/ocr'

// Public and unauthenticated — hit by the container HEALTHCHECK, deploy.sh
// and any external uptime monitor. Reports only what an operator needs to
// tell "healthy" from "broken", never configuration details (which optional
// integrations are set up), connection strings or errors.
//
// Load-bearing checks (any failure -> 503):
//   database — a real round trip
//   storage  — the documents directory is writable (bind mount present)
//   ocr      — the bundled language models are installed

export async function GET() {
  const checks: Record<string, boolean> = {}

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = true
  } catch (err) {
    console.error('[health] database check failed', err)
    checks.database = false
  }

  try {
    await access(join(process.cwd(), 'storage', 'case-documents'), constants.W_OK)
    checks.storage = true
  } catch {
    checks.storage = false
  }

  checks.ocr = missingOcrModels().length === 0

  const healthy = Object.values(checks).every(Boolean)
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.APP_VERSION || 'dev',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}
