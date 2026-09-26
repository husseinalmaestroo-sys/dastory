import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { decimalsToNumbers, parseMoney } from './money'

describe('parseMoney — exact, 3 decimals, never via float arithmetic', () => {
  it.each([
    [100, '100'], ['100.5', '100.5'], [0.2, '0.2'], ['0.001', '0.001'], ['999999999.999', '999999999.999'], [0, '0'],
  ])('accepts %s', (input, expected) => {
    expect(parseMoney(input)?.toString()).toBe(expected)
  })
  it.each([
    ['1.2345'], [0.30000000000000004], ['-1'], [-1], ['1e3'], ['abc'], [''], [NaN], [Infinity], ['1000000000'], [null], [{}],
  ])('rejects %s', (input) => {
    expect(parseMoney(input)).toBeNull()
  })
})

describe('decimalsToNumbers', () => {
  it('turns nested Decimals into exact JSON numbers and leaves everything else', () => {
    const date = new Date('2030-01-01T00:00:00Z')
    const out = decimalsToNumbers({ a: new Prisma.Decimal('0.3'), list: [{ b: new Prisma.Decimal('1234.567') }], d: date, s: 'x', n: null })
    expect(out).toEqual({ a: 0.3, list: [{ b: 1234.567 }], d: date, s: 'x', n: null })
  })
})
