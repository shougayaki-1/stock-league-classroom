import { describe, expect, it, vi } from 'vitest'
import { createStripeCheckoutSession } from './stripeCheckout'
describe('createStripeCheckoutSession', () => {
  it('rejects a plan with no stripePriceId', async () => await expect(createStripeCheckoutSession({ getPlanDefinition: async () => ({ stripePriceId: null }), createBillingRecord: vi.fn(), createCheckoutSession: vi.fn() }, { orgId: 'org-1', planId: 'FREE', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })).rejects.toThrow('このプランはまだ決済に対応していません'))
  it('creates the pending record before the Stripe session', async () => { const record = vi.fn().mockResolvedValue('record-1'), session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' }); await expect(createStripeCheckoutSession({ getPlanDefinition: async () => ({ stripePriceId: 'price_1' }), createBillingRecord: record, createCheckoutSession: session, now: () => 'now' }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })).resolves.toEqual({ url: 'https://checkout.stripe.com/s' }); expect(record).toHaveBeenCalledWith('org-1', { status: 'PENDING', paymentMethod: 'CARD', planId: 'SCHOOL', createdAt: 'now' }); expect(session).toHaveBeenCalledWith({ priceId: 'price_1', clientReferenceId: 'org-1:record-1', successUrl: 'https://x/s', cancelUrl: 'https://x/c', customerId: undefined }) })
  it('reuses an existing Stripe customer id when the organization already has one', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({ getPlanDefinition: async () => ({ stripePriceId: 'price_1' }), createBillingRecord: vi.fn().mockResolvedValue('record-1'), createCheckoutSession: session, getExistingStripeCustomerId: async (orgId) => { expect(orgId).toBe('org-1'); return 'cus_existing' } }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_existing' }))
  })
  it('omits customerId when the organization has no existing Stripe customer', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({ getPlanDefinition: async () => ({ stripePriceId: 'price_1' }), createBillingRecord: vi.fn().mockResolvedValue('record-1'), createCheckoutSession: session, getExistingStripeCustomerId: async () => null }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })
  it('falls back to creating a new customer when reading the existing id fails', async () => {
    const session = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/s' })
    await createStripeCheckoutSession({ getPlanDefinition: async () => ({ stripePriceId: 'price_1' }), createBillingRecord: vi.fn().mockResolvedValue('record-1'), createCheckoutSession: session, getExistingStripeCustomerId: async () => { throw new Error('Firestore unavailable') } }, { orgId: 'org-1', planId: 'SCHOOL', successUrl: 'https://x/s', cancelUrl: 'https://x/c' })
    expect(session).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })
})
