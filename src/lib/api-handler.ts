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
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        console.error('[api] unique constraint violation', err.meta)
        return NextResponse.json({ error: 'يوجد سجل بنفس القيمة مسبقاً' }, { status: 409 })
      }
      // No-op when SENTRY_DSN is unset; scrubbed by beforeSend when it isn't.
      Sentry.captureException(err)
      console.error('[api] unhandled error', err)
      return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 })
    }
  }
}
