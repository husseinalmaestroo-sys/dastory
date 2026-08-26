import { describe, expect, it } from 'vitest'
import { resolveEmailAuthorization } from './email-authorization'

const lawyer = { role: 'LAWYER' as const, officeId: 'off-1' }
const manager = { role: 'OFFICE_MANAGER' as const, officeId: 'off-1' }
const citizen = { role: 'CITIZEN' as const, officeId: 'off-1' }

describe('resolveEmailAuthorization', () => {
  it('allows a lawyer to email a client visible to them', () => {
    const result = resolveEmailAuthorization(lawyer, {
      matchedClient: { officeId: 'off-1', email: 'client@x.jo' },
    })
    expect(result).toEqual({ allowed: true, reason: 'client_recipient' })
  })

  it('allows a lawyer to email a colleague in the same office', () => {
    const result = resolveEmailAuthorization(lawyer, {
      matchedColleague: { officeId: 'off-1', email: 'colleague@x.jo' },
    })
    expect(result).toEqual({ allowed: true, reason: 'colleague_recipient' })
  })

  it('denies a lawyer emailing an arbitrary unassociated recipient', () => {
    const result = resolveEmailAuthorization(lawyer, {})
    expect(result).toEqual({ allowed: false, reason: 'recipient_not_associated' })
  })

  it('denies a lawyer emailing a client that belongs to a different office (cross-tenant)', () => {
    const result = resolveEmailAuthorization(lawyer, {
      matchedClient: { officeId: 'off-2', email: 'client@other-office.jo' },
    })
    expect(result).toEqual({ allowed: false, reason: 'recipient_not_associated' })
  })

  it('denies a lawyer emailing a colleague from a different office', () => {
    const result = resolveEmailAuthorization(lawyer, {
      matchedColleague: { officeId: 'off-2', email: 'someone@other-office.jo' },
    })
    expect(result).toEqual({ allowed: false, reason: 'recipient_not_associated' })
  })

  it('allows an office manager to email an arbitrary external recipient', () => {
    const result = resolveEmailAuthorization(manager, {})
    expect(result).toEqual({ allowed: true, reason: 'manager_override' })
  })

  it('still prefers the specific match reason for a manager when a client matches', () => {
    const result = resolveEmailAuthorization(manager, {
      matchedClient: { officeId: 'off-1', email: 'client@x.jo' },
    })
    expect(result).toEqual({ allowed: true, reason: 'client_recipient' })
  })

  it('denies a CITIZEN role outright, even with a matching client (defense in depth)', () => {
    const result = resolveEmailAuthorization(citizen, {
      matchedClient: { officeId: 'off-1', email: 'client@x.jo' },
    })
    expect(result).toEqual({ allowed: false, reason: 'citizen_role_not_permitted' })
  })
})
