import { afterEach, describe, expect, it } from 'vitest'
import { POST as signup } from '@/app/api/auth/signup/route'
import { GET as billingStatus } from '@/app/api/billing/status/route'
import { cleanupOffice, readJson, testRequest } from './helpers'
import { prisma } from '@/lib/prisma'

const createdOffices: string[] = []
afterEach(async () => {
  await Promise.all(createdOffices.splice(0).map(cleanupOffice))
})

describe('billing — trial subscription on signup', () => {
  it('a new signup automatically gets a real TRIALING subscription (not just a marketing claim)', async () => {
    const email = `billing-test-${Date.now()}@example.jo`
    const res = await signup(testRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Billing Test', email, password: 'TestPassw0rd!23', officeName: 'Billing Test Office' },
    }))
    expect(res.status).toBe(201)
    const body = await readJson(res)
    createdOffices.push(body.user.officeId)

    const subscription = await prisma.subscription.findUnique({
      where: { officeId: body.user.officeId },
      include: { plan: true },
    })
    expect(subscription).not.toBeNull()
    expect(subscription?.status).toBe('TRIALING')
    expect(subscription?.plan.key).toBe('basic')
    expect(subscription?.trialEndsAt).not.toBeNull()
    expect(subscription!.trialEndsAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('billing status requires authentication', async () => {
    const res = await billingStatus(testRequest('/api/billing/status'))
    expect(res.status).toBe(401)
  })

  it('billing status is tenant-scoped and honestly reports no payment provider connected', async () => {
    const email = `billing-test2-${Date.now()}@example.jo`
    const signupRes = await signup(testRequest('/api/auth/signup', {
      method: 'POST',
      body: { name: 'Billing Test 2', email, password: 'TestPassw0rd!23', officeName: 'Billing Test Office 2' },
    }))
    const signupBody = await readJson(signupRes)
    createdOffices.push(signupBody.user.officeId)

    const cookie = signupRes.headers.get('set-cookie')?.match(/ds_token=[^;]+/)?.[0] ?? ''
    const res = await billingStatus(testRequest('/api/billing/status', { headers: { Cookie: cookie } }))
    expect(res.status).toBe(200)
    const status = await readJson(res)
    expect(status.status).toBe('TRIALING')
    expect(status.paymentProviderConnected).toBe(false)
  })
})
