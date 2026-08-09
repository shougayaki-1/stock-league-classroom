import { describe, expect, it, vi } from 'vitest'
import { handleStripeWebhookEvent } from './stripeWebhook'
describe('handleStripeWebhookEvent', () => {
  it('ignores unrelated and malformed events', async () => { const markBillingRecordPaid = vi.fn(); await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid }, { type: 'invoice.payment_failed' }); await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid }, { type: 'checkout.session.completed', clientReferenceId: 'bad', stripeSessionId: 's' }); expect(markBillingRecordPaid).not.toHaveBeenCalled() })
  it('marks a pending record paid and is idempotent', async () => { const mark = vi.fn(); await handleStripeWebhookEvent({ getBillingRecord: async () => ({ status: 'PENDING' }), markBillingRecordPaid: mark }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's' }); expect(mark).toHaveBeenCalledWith('org-1', 'record-1', 's'); await handleStripeWebhookEvent({ getBillingRecord: async () => ({ status: 'PAID' }), markBillingRecordPaid: mark }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's' }); expect(mark).toHaveBeenCalledTimes(1) })
})

describe('handleStripeWebhookEvent — subscription lifecycle', () => {
  it('links the Stripe customer id on checkout.session.completed', async () => {
    const linkStripeCustomer = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async () => ({ status: 'PENDING' }), markBillingRecordPaid: vi.fn(), linkStripeCustomer,
      getOrgIdForStripeCustomer: vi.fn(), setSubscriptionStatus: vi.fn(), hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's', stripeCustomerId: 'cus_1' })
    expect(linkStripeCustomer).toHaveBeenCalledWith('org-1', 'cus_1')
  })

  it('marks the subscription ACTIVE and records a new PAID billing record on invoice.paid', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async (id) => { expect(id).toBe('cus_1'); return 'org-1' },
      setSubscriptionStatus, hasBillingRecordForInvoice: async () => false, createBillingRecordForInvoice,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'ACTIVE')
    expect(createBillingRecordForInvoice).toHaveBeenCalledWith('org-1', 'in_1', 'PAID')
  })

  it('is idempotent per invoice id on invoice.paid', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: async () => true, createBillingRecordForInvoice,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
    expect(createBillingRecordForInvoice).not.toHaveBeenCalled()
  })

  it('marks the subscription PAST_DUE and records OVERDUE on invoice.payment_failed', async () => {
    const setSubscriptionStatus = vi.fn()
    const createBillingRecordForInvoice = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: async () => false, createBillingRecordForInvoice,
    }, { type: 'invoice.payment_failed', invoiceId: 'in_2', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'PAST_DUE')
    expect(createBillingRecordForInvoice).toHaveBeenCalledWith('org-1', 'in_2', 'OVERDUE')
  })

  it('marks the subscription CANCELED on customer.subscription.deleted', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'CANCELED')
  })

  it('does nothing when the Stripe customer id cannot be resolved to an organization', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus, hasBillingRecordForInvoice: vi.fn(), createBillingRecordForInvoice: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
  })
})
