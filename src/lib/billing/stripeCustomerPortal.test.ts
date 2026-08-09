import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createStripeCustomerPortalSession } from './stripeCustomerPortal'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('createStripeCustomerPortalSession', () => {
  it('calls createStripeCustomerPortalSessionCallable with the input', async () => {
    const call = vi.fn().mockResolvedValue({ data: { url: 'https://billing.stripe.com/p/x' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    const input = { orgId: 'org-1', returnUrl: 'https://x/return' }

    await expect(createStripeCustomerPortalSession({} as never, input)).resolves.toEqual({ url: 'https://billing.stripe.com/p/x' })

    expect(httpsCallable).toHaveBeenCalledWith({}, 'createStripeCustomerPortalSessionCallable')
    expect(call).toHaveBeenCalledWith(input)
  })
})
