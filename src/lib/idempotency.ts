import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// Idempotency-Key support for POST endpoints where a duplicate submission
// (double-click, browser retry, network timeout + client retry) would
// create a duplicate record. Opt-in via the `Idempotency-Key` request
// header — a request that doesn't send one behaves exactly as it did
// before this existed, so no existing caller (none currently send this
// header) changes behavior. Wiring a client to generate and send one is
// frontend work for later; this is the backend half.
//
// Race-safety: the (userId, endpoint, key) row is claimed via an INSERT
// *before* the handler runs, relying on the unique constraint to make the
// claim atomic. A concurrent second request with the same key loses that
// insert and either replays the first request's already-stored result, or
// — if the first request is still in flight — gets a 409 telling the
// client to retry shortly, rather than re-running the operation.

export type IdempotentResult = { status: number; body: unknown }

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

// A claim still marked in-flight (responseStatus 0) after this long belongs
// to a request that died mid-way (process crash/restart) — it may be retaken.
const STALE_IN_FLIGHT_MS = 2 * 60_000
// Keys are kept long enough to cover client retries, then pruned.
const KEY_RETENTION_MS = 24 * 60 * 60_000

export async function withIdempotency(
  req: NextRequest,
  userId: string,
  endpoint: string,
  handler: () => Promise<IdempotentResult>
): Promise<NextResponse> {
  const rawKey = req.headers.get('idempotency-key')?.trim()
  if (!rawKey || rawKey.length === 0 || rawKey.length > 191) {
    const result = await handler()
    return NextResponse.json(result.body, { status: result.status })
  }
  const keyWhere = { userId_endpoint_key: { userId, endpoint, key: rawKey } }

  // Opportunistic pruning of this user's expired keys.
  await prisma.idempotencyKey.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - KEY_RETENTION_MS) } } })

  const claim = async (): Promise<'claimed' | 'exists'> => {
    try {
      await prisma.idempotencyKey.create({ data: { userId, endpoint, key: rawKey } })
      return 'claimed'
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err
      return 'exists'
    }
  }

  if ((await claim()) === 'exists') {
    const existing = await prisma.idempotencyKey.findUnique({ where: keyWhere })
    if (existing && existing.responseStatus > 0) {
      return NextResponse.json(existing.responseBody, {
        status: existing.responseStatus,
        headers: { 'Idempotency-Replayed': 'true' },
      })
    }
    // Still in flight. If it's been "in flight" implausibly long, the
    // original request died without finishing — take the key over (the
    // conditional delete makes exactly one retaker win) instead of leaving
    // it poisoned forever.
    const stale = existing && existing.createdAt.getTime() < Date.now() - STALE_IN_FLIGHT_MS
    const retaken = stale
      ? (await prisma.idempotencyKey.deleteMany({ where: { id: existing.id, responseStatus: 0 } })).count === 1 && (await claim()) === 'claimed'
      : false
    if (!retaken) {
      return NextResponse.json(
        { error: 'طلب مطابق قيد المعالجة بالفعل، حاول لاحقاً' },
        { status: 409 }
      )
    }
  }

  let result: IdempotentResult
  try {
    result = await handler()
  } catch (err) {
    // The operation failed with a server error: release the key so the
    // client's retry (same key) runs the operation instead of getting a
    // permanent 409 for a request that never completed.
    await prisma.idempotencyKey.deleteMany({ where: { userId, endpoint, key: rawKey, responseStatus: 0 } }).catch(() => {})
    throw err
  }
  await prisma.idempotencyKey.update({
    where: keyWhere,
    data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
  })
  return NextResponse.json(result.body, { status: result.status })
}
