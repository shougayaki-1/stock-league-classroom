import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createStripeCheckoutSession } from './stripeCheckout'
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
describe('createStripeCheckoutSession', () => it('calls the Callable with the input', async () => { const call = vi.fn().mockResolvedValue({ data: { url: 'https://checkout.stripe.com/x' } }); vi.mocked(httpsCallable).mockReturnValue(call as never); const input = { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' }; await expect(createStripeCheckoutSession({} as never, input)).resolves.toEqual({ url: 'https://checkout.stripe.com/x' }); expect(call).toHaveBeenCalledWith(input) }))
