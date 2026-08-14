import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'
import {
  getBillingOverview,
  saveBillingProfile,
  startInvoiceSubscription,
  type BillingProfileInput,
} from './invoiceSubscription'

const callable = vi.fn()
const httpsCallable = vi.fn((_functions: unknown, _name: string) => callable)

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: Parameters<typeof httpsCallable>) => httpsCallable(...args),
}))

const functions = {} as Functions
const profile: BillingProfileInput = {
  legalName: '学校法人テスト学園',
  contactName: '総務部 山田花子',
  email: 'billing@example.com',
  address: {
    postalCode: '100-0001',
    prefecture: '東京都',
    city: '千代田区',
    line1: '千代田1-1',
    line2: '校舎2階',
  },
}

describe('invoice subscription callable wrappers', () => {
  beforeEach(() => {
    callable.mockReset()
    httpsCallable.mockClear()
  })

  it('saves the exact billing profile and unwraps the Stripe customer result', async () => {
    callable.mockResolvedValue({ data: { stripeCustomerId: 'cus_1' } })

    await expect(saveBillingProfile(functions, { orgId: 'school-1', profile })).resolves.toEqual({ stripeCustomerId: 'cus_1' })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'saveBillingProfileCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'school-1', profile })
  })

  it('starts invoice billing with the exact organization and unwraps a scheduled result', async () => {
    callable.mockResolvedValue({ data: { status: 'SCHEDULED', stripeScheduleId: 'sub_sched_1', currentPeriodEndMillis: 1_800_000_000_000 } })

    await expect(startInvoiceSubscription(functions, { orgId: 'school-1' })).resolves.toEqual({
      status: 'SCHEDULED',
      stripeScheduleId: 'sub_sched_1',
      currentPeriodEndMillis: 1_800_000_000_000,
    })

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'startInvoiceSubscriptionCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'school-1' })
  })

  it('loads the exact billing overview and unwraps its public DTO', async () => {
    const overview = {
      profile,
      paymentMethod: 'INVOICE' as const,
      invoiceSubscription: { status: 'ACTIVE' as const },
      invoices: [{
        id: 'in_1',
        status: 'PENDING' as const,
        paymentMethod: 'INVOICE' as const,
        dueDateMillis: 1_800_000_000_000,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/test',
      }],
    }
    callable.mockResolvedValue({ data: overview })

    await expect(getBillingOverview(functions, { orgId: 'school-1' })).resolves.toEqual(overview)

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'getBillingOverviewCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'school-1' })
  })
})
