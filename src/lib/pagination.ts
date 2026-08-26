import { NextRequest, NextResponse } from 'next/server'

// Cursor-based (keyset) pagination shared by every list endpoint.
//
// Design constraints this satisfies:
// - Response BODY stays a bare array, unchanged from before pagination
//   existed — existing frontend callers that don't send `cursor`/`limit`
//   keep working identically. Pagination metadata rides on response
//   headers instead (X-Has-More, X-Next-Cursor, X-Total-Count), the same
//   non-breaking pattern GitHub's REST API uses for its Link header.
// - The cursor encodes (sortValue, id) — id as a tiebreaker — so ordering
//   stays deterministic and stable even when many rows share the same
//   createdAt/date value (same-millisecond inserts are common with seeded
//   or bulk-created data).

export const DEFAULT_MAX_PAGE_SIZE = 200

export type SortDirection = 'asc' | 'desc'

export type DecodedCursor = { value: string; id: string }

export function encodeCursor(value: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: value.toISOString(), id })).toString('base64url')
}

export function decodeCursor(raw: string): DecodedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed?.v !== 'string' || typeof parsed?.id !== 'string' || !parsed.id) return null
    if (Number.isNaN(new Date(parsed.v).getTime())) return null
    return { value: parsed.v, id: parsed.id }
  } catch {
    return null
  }
}

export type PaginationParams = { limit: number; cursor: DecodedCursor | null }
export type PaginationResult =
  | { ok: true; params: PaginationParams }
  | { ok: false; response: NextResponse }

/**
 * Parses and validates `limit`/`cursor` query params.
 * `defaultLimit` lets each route preserve its own pre-existing default
 * when `limit` is omitted, so behavior for existing callers is unchanged.
 */
export function parsePagination(req: NextRequest, defaultLimit: number, maxLimit = DEFAULT_MAX_PAGE_SIZE): PaginationResult {
  const sp = req.nextUrl.searchParams
  const rawLimit = sp.get('limit')
  let limit = defaultLimit
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return { ok: false, response: NextResponse.json({ error: 'قيمة limit غير صالحة' }, { status: 400 }) }
    }
    limit = Math.min(n, maxLimit)
  }

  const rawCursor = sp.get('cursor')
  let cursor: DecodedCursor | null = null
  if (rawCursor) {
    cursor = decodeCursor(rawCursor)
    if (!cursor) {
      return { ok: false, response: NextResponse.json({ error: 'قيمة cursor غير صالحة' }, { status: 400 }) }
    }
  }

  return { ok: true, params: { limit, cursor } }
}

/** Combines multiple Prisma where-fragments with AND, dropping empty ones. */
export function combineWhere(...parts: Record<string, unknown>[]): Record<string, unknown> {
  const nonEmpty = parts.filter((p) => p && Object.keys(p).length > 0)
  if (nonEmpty.length === 0) return {}
  if (nonEmpty.length === 1) return nonEmpty[0]
  return { AND: nonEmpty }
}

/**
 * Builds the where-clause fragment for keyset pagination on (dateField, id).
 * Combine with combineWhere() alongside any tenant/search filters — never
 * spread-merge it, since both may contain an `OR` key.
 */
export function cursorWhereClause(dateField: string, direction: SortDirection, cursor: DecodedCursor | null): Record<string, unknown> {
  if (!cursor) return {}
  const op = direction === 'desc' ? 'lt' : 'gt'
  const cursorDate = new Date(cursor.value)
  return {
    OR: [
      { [dateField]: { [op]: cursorDate } },
      { [dateField]: cursorDate, id: { [op]: cursor.id } },
    ],
  }
}

export type Page<T> = { page: T[]; hasMore: boolean; nextCursor: string | null }

/**
 * Splits a `limit + 1`-sized query result into a page + hasMore/nextCursor.
 * Callers should `take: limit + 1` and pass the raw result here.
 */
export function buildPage<T extends { id: string }>(rows: T[], limit: number, getDateValue: (row: T) => Date): Page<T> {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(getDateValue(last), last.id) : null
  return { page, hasMore, nextCursor }
}

/** Builds the response headers carrying pagination metadata. */
export function paginationHeaders(result: Page<unknown>, total?: number): Record<string, string> {
  const headers: Record<string, string> = { 'X-Has-More': String(result.hasMore) }
  if (result.nextCursor) headers['X-Next-Cursor'] = result.nextCursor
  if (total !== undefined) headers['X-Total-Count'] = String(total)
  return headers
}
