import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

// Wraps a Route Handler so an unexpected exception (a DB constraint
// violation not pre-checked by the route, a connection drop, etc.) always
// produces a proper JSON error response instead of whatever Next.js's own
// default happens to be.
//
// Verified empirically (not assumed): an uncaught exception in an
// unwrapped handler already reaches the client as a 500 with no leaked
// stack trace or secret — Next.js's framework-level handling covers that.
// What it does NOT do is give a JSON body: the response comes back with an
// empty body and no Content-Type, which breaks every caller in this
// codebase, since all of them do fetch(...).then(r => r.json()) — that
// throws "Unexpected end of JSON input" instead of surfacing any error at
// all. This wrapper's whole job is closing that specific gap: consistent
// {error} JSON, a real server-side log line, and (via the P2002 branch) a
// friendlier status for the one DB error shape common enough to name.
// Predictable database outcomes that are the caller's doing (or a benign
// race), not server faults — answered with a 4xx and a stable `code`, never
// a stack trace. Routes validate input first; this is the backstop for what
// validation can't see (concurrent writes, dependent rows, schema limits).
const KNOWN_PRISMA_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  // Unique constraint (duplicate case/invoice number, email, idempotency key…)
  P2002: { status: 409, code: 'duplicate', message: 'يوجد سجل بنفس القيمة مسبقاً' },
  // Foreign-key constraint — the row is still referenced by another record
  // (e.g. a signed document's signature trail), or references a missing one.
  P2003: { status: 409, code: 'related_records', message: 'لا يمكن تنفيذ العملية لوجود سجلات مرتبطة بهذا العنصر' },
  // Value too long for its column.
  P2000: { status: 400, code: 'value_too_long', message: 'إحدى القيم أطول من الحد المسموح' },
  // Record to update/delete no longer exists (deleted concurrently).
  P2025: { status: 404, code: 'not_found', message: 'غير موجود' },
  // Transaction write conflict / deadlock — safe for the client to retry.
  P2034: { status: 409, code: 'write_conflict', message: 'تعارضت العملية مع تعديل متزامن — حاول مرة أخرى' },
}

export function mapKnownPrismaError(err: Prisma.PrismaClientKnownRequestError) {
  return KNOWN_PRISMA_ERRORS[err.code] ?? null
}

export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const mapped = mapKnownPrismaError(err)
        if (mapped) {
          console.error(`[api] ${err.code}`, err.meta)
          return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status })
        }
      }
      // No-op when SENTRY_DSN is unset; scrubbed by beforeSend when it isn't.
      Sentry.captureException(err)
      console.error('[api] unhandled error', err)
      return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
    }
  }
}
