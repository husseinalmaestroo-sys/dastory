import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'

// Money is stored as DECIMAL(12,3) — JOD has 3 minor-unit digits (fils) — and
// handled as Prisma.Decimal on the server: parsing, comparison, and any
// arithmetic are exact. It used to be DOUBLE, so sums and edits accumulated
// binary floating-point error (0.1 + 0.2 ≠ 0.3).
export const MONEY_SCALE = 3
export const MONEY_MAX = new Prisma.Decimal('999999999.999')

const MONEY_RE = /^\d+(\.\d+)?$/

/**
 * Parses a non-negative money amount from JSON input (number or numeric
 * string). Returns null for anything that isn't a plain decimal, has more
 * than 3 fractional digits, or exceeds the column's range — callers turn
 * null into a 400. Numbers are read from their shortest decimal string form
 * (String(100.5) === "100.5"), never through float arithmetic.
 */
export function parseMoney(value: unknown): Prisma.Decimal | null {
  let raw: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    raw = String(value)
  } else if (typeof value === 'string') {
    raw = value.trim()
  } else {
    return null
  }
  if (!MONEY_RE.test(raw)) return null
  const amount = new Prisma.Decimal(raw)
  if (amount.decimalPlaces() > MONEY_SCALE || amount.gt(MONEY_MAX)) return null
  return amount
}

/**
 * Converts every Prisma.Decimal inside a value to a JSON number. Lossless for
 * this column: a DECIMAL(12,3) value has at most 12 significant digits, well
 * inside a double's exact range, so the number that reaches the client prints
 * back to the same decimal. (Prisma.Decimal would otherwise serialize as a
 * string, silently changing the API's types.) Sums and comparisons stay
 * server-side, in Decimal.
 */
export function decimalsToNumbers<T>(value: T): T {
  if (Prisma.Decimal.isDecimal(value)) return Number((value as Prisma.Decimal).toFixed(MONEY_SCALE)) as T
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  if (Array.isArray(value)) return value.map((v) => decimalsToNumbers(v)) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = decimalsToNumbers(v)
  return out as T
}

/** NextResponse.json for payloads that may contain money. */
export function jsonWithMoney(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(decimalsToNumbers(data), init)
}
