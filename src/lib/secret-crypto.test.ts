import { describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret, isLegacyPlaintext, resolveAndMigrateSecret } from './secret-crypto'

// TWO_FACTOR_ENCRYPTION_KEY is set in vitest.setup.mts for the whole test run.

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a TOTP secret', () => {
    const plain = 'JBSWY3DPEHPK3PXP'
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const plain = 'JBSWY3DPEHPK3PXP'
    expect(encryptSecret(plain)).not.toBe(encryptSecret(plain))
  })

  it('prefixes ciphertext with the version marker', () => {
    expect(encryptSecret('JBSWY3DPEHPK3PXP').startsWith('v1:')).toBe(true)
  })

  it('never stores the plaintext secret as a literal substring of the ciphertext', () => {
    const plain = 'JBSWY3DPEHPK3PXP'
    expect(encryptSecret(plain)).not.toContain(plain)
  })

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP')
    const [v1, iv, tag, data] = stored.split(':')
    const tamperedByte = Buffer.from(data, 'base64')
    tamperedByte[0] ^= 0xff
    const tampered = [v1, iv, tag, tamperedByte.toString('base64')].join(':')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rejects a tampered auth tag', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP')
    const [v1, iv, tag, data] = stored.split(':')
    const tamperedTag = Buffer.from(tag, 'base64')
    tamperedTag[0] ^= 0xff
    const tampered = [v1, iv, tamperedTag.toString('base64'), data].join(':')
    expect(() => decryptSecret(tampered)).toThrow()
  })
})

describe('isLegacyPlaintext', () => {
  it('is true for a raw base32 TOTP secret (no v1: prefix)', () => {
    expect(isLegacyPlaintext('JBSWY3DPEHPK3PXP')).toBe(true)
  })

  it('is false for an encrypted value', () => {
    expect(isLegacyPlaintext(encryptSecret('JBSWY3DPEHPK3PXP'))).toBe(false)
  })
})

describe('decryptSecret with legacy plaintext', () => {
  it('passes a legacy plaintext value through unchanged', () => {
    expect(decryptSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP')
  })
})

describe('resolveAndMigrateSecret', () => {
  it('returns the plaintext for an already-encrypted value and does not call persist', async () => {
    const plain = 'JBSWY3DPEHPK3PXP'
    const persist = vi.fn().mockResolvedValue(undefined)
    const result = await resolveAndMigrateSecret(encryptSecret(plain), persist)
    expect(result).toBe(plain)
    expect(persist).not.toHaveBeenCalled()
  })

  it('migrates a legacy plaintext value by calling persist with a valid encrypted form', async () => {
    const plain = 'JBSWY3DPEHPK3PXP'
    let persisted = ''
    const persist = vi.fn(async (encrypted: string) => {
      persisted = encrypted
    })

    const result = await resolveAndMigrateSecret(plain, persist)

    expect(result).toBe(plain)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(isLegacyPlaintext(persisted)).toBe(false)
    expect(decryptSecret(persisted)).toBe(plain)
  })
})
