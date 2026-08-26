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

export async function withIdempotency(
  req: NextRequest,
  userId: string,
  endpoint: string,
  handler: () => Promise<IdempotentResult>
): Promise<NextResponse> {
  const rawKey = req.headers.get('idempotency-key')?.trim()
  if (!rawKey || rawKey.length === 0 || rawKey.length > 200) {
    const result = await handler()
    return NextResponse.json(result.body, { status: result.status })
  }

  try {
    await prisma.idempotencyKey.create({
      data: { userId, endpoint, key: rawKey },
    })
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err

    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: { userId, endpoint, key: rawKey } },
    })
    if (existing && existing.responseStatus > 0) {
      return NextResponse.json(existing.responseBody, {
        status: existing.responseStatus,
        headers: { 'Idempotency-Replayed': 'true' },
      })
    }
    return NextResponse.json(
      { error: 'طلب مطابق قيد المعالجة بالفعل، حاول لاحقاً' },
      { status: 409 }
    )
  }

  const result = await handler()
  await prisma.idempotencyKey.update({
    where: { userId_endpoint_key: { userId, endpoint, key: rawKey } },
    data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
  })
  return NextResponse.json(result.body, { status: result.status })
}
