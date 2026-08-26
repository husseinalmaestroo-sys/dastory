import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  buildPage,
  combineWhere,
  cursorWhereClause,
  decodeCursor,
  encodeCursor,
  paginationHeaders,
  parsePagination,
} from './pagination'

function req(query: string) {
  return new NextRequest(`https://dostoori.jo/api/test${query}`)
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a date and id', () => {
    const date = new Date('2026-01-15T10:30:00.000Z')
    const encoded = encodeCursor(date, 'abc123')
    const decoded = decodeCursor(encoded)
    expect(decoded).toEqual({ value: date.toISOString(), id: 'abc123' })
  })

  it('rejects garbage input', () => {
    expect(decodeCursor('not-valid-base64url-json!!!')).toBeNull()
  })

  it('rejects valid base64url that decodes to non-JSON', () => {
    const junk = Buffer.from('just some text').toString('base64url')
    expect(decodeCursor(junk)).toBeNull()
  })

  it('rejects JSON missing required fields', () => {
    const missingId = Buffer.from(JSON.stringify({ v: new Date().toISOString() })).toString('base64url')
    expect(decodeCursor(missingId)).toBeNull()
    const missingValue = Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url')
    expect(decodeCursor(missingValue)).toBeNull()
  })

  it('rejects an invalid date value', () => {
    const bad = Buffer.from(JSON.stringify({ v: 'not-a-date', id: 'x' })).toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })

  it('rejects an empty id', () => {
    const bad = Buffer.from(JSON.stringify({ v: new Date().toISOString(), id: '' })).toString('base64url')
    expect(decodeCursor(bad)).toBeNull()
  })
})

describe('parsePagination', () => {
  it('uses the provided default limit when omitted', () => {
    const result = parsePagination(req(''), 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.limit).toBe(50)
  })

  it('honors an explicit valid limit', () => {
    const result = parsePagination(req('?limit=10'), 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.limit).toBe(10)
  })

  it('caps limit at maxLimit even if a larger value is requested', () => {
    const result = parsePagination(req('?limit=99999'), 50, 200)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.limit).toBe(200)
  })

  it('rejects a non-numeric limit', () => {
    const result = parsePagination(req('?limit=abc'), 50)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('rejects a zero limit', () => {
    const result = parsePagination(req('?limit=0'), 50)
    expect(result.ok).toBe(false)
  })

  it('rejects a negative limit', () => {
    const result = parsePagination(req('?limit=-5'), 50)
    expect(result.ok).toBe(false)
  })

  it('rejects a non-integer limit', () => {
    const result = parsePagination(req('?limit=1.5'), 50)
    expect(result.ok).toBe(false)
  })

  it('returns no cursor when omitted', () => {
    const result = parsePagination(req(''), 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.cursor).toBeNull()
  })

  it('decodes a valid cursor', () => {
    const cursor = encodeCursor(new Date('2026-01-01T00:00:00.000Z'), 'row-1')
    const result = parsePagination(req(`?cursor=${cursor}`), 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.params.cursor).toEqual({ value: '2026-01-01T00:00:00.000Z', id: 'row-1' })
  })

  it('rejects an invalid cursor', () => {
    const result = parsePagination(req('?cursor=garbage'), 50)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })
})

describe('combineWhere', () => {
  it('returns an empty object when all parts are empty', () => {
    expect(combineWhere({}, {})).toEqual({})
  })

  it('returns the single part directly when only one is non-empty', () => {
    expect(combineWhere({}, { officeId: 'off-1' })).toEqual({ officeId: 'off-1' })
  })

  it('wraps multiple non-empty parts in AND', () => {
    const result = combineWhere({ officeId: 'off-1' }, { active: true })
    expect(result).toEqual({ AND: [{ officeId: 'off-1' }, { active: true }] })
  })

  it('preserves two independent OR clauses instead of letting one overwrite the other', () => {
    const searchClause = { OR: [{ name: { contains: 'ali' } }] }
    const cursorClause = { OR: [{ createdAt: { lt: new Date('2026-01-01') } }] }
    const result = combineWhere(searchClause, cursorClause) as { AND: unknown[] }
    expect(result.AND).toHaveLength(2)
    expect(result.AND).toContainEqual(searchClause)
    expect(result.AND).toContainEqual(cursorClause)
  })
})

describe('cursorWhereClause', () => {
  it('returns an empty object for a null cursor (first page)', () => {
    expect(cursorWhereClause('createdAt', 'desc', null)).toEqual({})
  })

  it('uses lt for descending order', () => {
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'row-5' }
    const clause = cursorWhereClause('createdAt', 'desc', cursor) as { OR: unknown[] }
    expect(clause.OR).toEqual([
      { createdAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
      { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: { lt: 'row-5' } },
    ])
  })

  it('uses gt for ascending order', () => {
    const cursor = { value: '2026-01-01T00:00:00.000Z', id: 'row-5' }
    const clause = cursorWhereClause('date', 'asc', cursor) as { OR: unknown[] }
    expect(clause.OR).toEqual([
      { date: { gt: new Date('2026-01-01T00:00:00.000Z') } },
      { date: new Date('2026-01-01T00:00:00.000Z'), id: { gt: 'row-5' } },
    ])
  })
})

type Row = { id: string; createdAt: Date }
const row = (id: string, iso: string): Row => ({ id, createdAt: new Date(iso) })

describe('buildPage', () => {
  it('final page: fewer rows than limit means no more pages', () => {
    const rows = [row('a', '2026-01-03T00:00:00Z'), row('b', '2026-01-02T00:00:00Z')]
    const result = buildPage(rows, 5, (r) => r.createdAt)
    expect(result.page).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('first/middle page: exactly limit+1 rows fetched means more pages exist', () => {
    const rows = [
      row('a', '2026-01-05T00:00:00Z'),
      row('b', '2026-01-04T00:00:00Z'),
      row('c', '2026-01-03T00:00:00Z'),
    ]
    const result = buildPage(rows, 2, (r) => r.createdAt)
    expect(result.page.map((r) => r.id)).toEqual(['a', 'b'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(encodeCursor(new Date('2026-01-04T00:00:00Z'), 'b'))
  })

  it('maximum page size: page never exceeds limit even when more rows were fetched for lookahead', () => {
    const rows = Array.from({ length: 201 }, (_, i) => row(`id-${i}`, new Date(2026, 0, 1, 0, 0, i).toISOString()))
    const result = buildPage(rows, 200, (r) => r.createdAt)
    expect(result.page).toHaveLength(200)
    expect(result.hasMore).toBe(true)
  })

  it('next-page cursor points at the last row of the trimmed page, not the lookahead row', () => {
    const rows = [row('a', '2026-01-03T00:00:00Z'), row('b', '2026-01-02T00:00:00Z'), row('c', '2026-01-01T00:00:00Z')]
    const result = buildPage(rows, 2, (r) => r.createdAt)
    const decoded = decodeCursor(result.nextCursor!)
    expect(decoded?.id).toBe('b')
    expect(decoded?.id).not.toBe('c')
  })

  it('empty result set', () => {
    const result = buildPage([], 50, (r: Row) => r.createdAt)
    expect(result.page).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })
})

describe('paginationHeaders', () => {
  it('always includes X-Has-More', () => {
    const headers = paginationHeaders({ page: [], hasMore: false, nextCursor: null })
    expect(headers['X-Has-More']).toBe('false')
    expect(headers['X-Next-Cursor']).toBeUndefined()
  })

  it('includes X-Next-Cursor only when there is a next page', () => {
    const headers = paginationHeaders({ page: [], hasMore: true, nextCursor: 'abc' })
    expect(headers['X-Next-Cursor']).toBe('abc')
  })

  it('includes X-Total-Count only when a total was provided', () => {
    const withTotal = paginationHeaders({ page: [], hasMore: false, nextCursor: null }, 42)
    expect(withTotal['X-Total-Count']).toBe('42')
    const withoutTotal = paginationHeaders({ page: [], hasMore: false, nextCursor: null })
    expect(withoutTotal['X-Total-Count']).toBeUndefined()
  })
})
