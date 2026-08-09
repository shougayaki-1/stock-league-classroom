import { describe, expect, it, vi } from 'vitest'
import { createStripeCustomerPortalSession } from './stripeCustomerPortal'

describe('createStripeCustomerPortalSession', () => {
  it('rejects an organization with no stripeCustomerId', async () => {
    await expect(createStripeCustomerPortalSession({
      getStripeCustomerId: async () => null,
      createPortalSession: vi.fn(),
    }, { orgId: 'org-1', returnUrl: 'https://x/return' })).rejects.toThrow('まだ決済履歴がありません')
  })

  it('creates a portal session for the organization\'s Stripe customer', async () => {
    const createPortalSession = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/p/x' })

    const result = await createStripeCustomerPortalSession({
      getStripeCustomerId: async (orgId) => {
        expect(orgId).toBe('org-1')
        return 'cus_1'
      },
      createPortalSession,
    }, { orgId: 'org-1', returnUrl: 'https://x/return' })

    expect(createPortalSession).toHaveBeenCalledWith({ customerId: 'cus_1', returnUrl: 'https://x/return' })
    expect(result).toEqual({ url: 'https://billing.stripe.com/p/x' })
  })
})
