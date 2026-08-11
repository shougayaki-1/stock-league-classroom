import { describe, expect, it, vi } from 'vitest'
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore'
import { createFirestoreInvoiceLifecycleApplier, createFirestoreSubscriptionPlanChangeSynchronizer, handleStripeWebhookEvent, sendStripeWebhookOutcome } from './stripeWebhook'
describe('handleStripeWebhookEvent', () => {
  it('ignores unrelated and malformed events', async () => { const markBillingRecordPaid = vi.fn(); await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid }, { type: 'invoice.payment_failed' }); await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid }, { type: 'checkout.session.completed', clientReferenceId: 'bad', stripeSessionId: 's' }); expect(markBillingRecordPaid).not.toHaveBeenCalled() })
  it('marks a pending record paid and is idempotent', async () => { const mark = vi.fn(); await handleStripeWebhookEvent({ getBillingRecord: async () => ({ status: 'PENDING' }), markBillingRecordPaid: mark }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's' }); expect(mark).toHaveBeenCalledWith('org-1', 'record-1', 's'); await handleStripeWebhookEvent({ getBillingRecord: async () => ({ status: 'PAID' }), markBillingRecordPaid: mark }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's' }); expect(mark).toHaveBeenCalledTimes(1) })
})

describe('handleStripeWebhookEvent — subscription lifecycle', () => {
  it('applies a pending downgrade when Stripe releases its schedule after the target price becomes current', async () => {
    const syncSubscriptionPlanChange = vi.fn()
    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async () => 'SCHOOL',
      getPendingPlanChange: async () => ({ planId: 'SCHOOL', stripeScheduleId: 'sub_sched_1' }),
      syncSubscriptionPlanChange,
      clearPendingPlanChange: vi.fn(),
    }, { type: 'customer.subscription.updated', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', currentPriceId: 'price_school' })).resolves.toEqual({ status: 'ok' })
    expect(syncSubscriptionPlanChange).toHaveBeenCalledWith('org-1', {
      kind: 'APPLY', planId: 'SCHOOL', stripeSubscriptionId: 'sub_1', stripeScheduleId: 'sub_sched_1',
    })
  })

  it('synchronizes a future lower price as a scheduled plan change', async () => {
    const syncSubscriptionPlanChange = vi.fn()
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async (priceId) => priceId === 'price_pro' ? 'PRO' : null,
      getScheduledPlanChange: async (scheduleId) => {
        expect(scheduleId).toBe('sub_sched_1')
        return { planId: 'SCHOOL', effectiveAtMillis: 2_000 }
      },
      getPendingPlanChange: async () => null,
      syncSubscriptionPlanChange,
    }, {
      type: 'customer.subscription.updated',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      currentPriceId: 'price_pro',
      stripeScheduleId: 'sub_sched_1',
    })

    expect(result).toEqual({ status: 'ok' })
    expect(syncSubscriptionPlanChange).toHaveBeenCalledWith('org-1', expect.objectContaining({
      kind: 'SCHEDULE', planId: 'SCHOOL', effectiveAtMillis: 2_000,
    }))
  })

  it('applies a current lower price only when it matches the saved pending plan', async () => {
    const syncSubscriptionPlanChange = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async () => 'SCHOOL',
      getScheduledPlanChange: async () => ({ planId: 'SCHOOL', effectiveAtMillis: 2_000 }),
      getPendingPlanChange: async () => ({ planId: 'SCHOOL', stripeScheduleId: 'sub_sched_1' }),
      syncSubscriptionPlanChange,
    }, {
      type: 'customer.subscription.updated', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
      currentPriceId: 'price_school', stripeScheduleId: 'sub_sched_1',
    })

    expect(syncSubscriptionPlanChange).toHaveBeenCalledWith('org-1', expect.objectContaining({ kind: 'APPLY', planId: 'SCHOOL' }))
  })

  it('returns retry when a subscription customer cannot be resolved', async () => {
    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null,
    }, {
      type: 'customer.subscription.updated', stripeCustomerId: 'cus_unknown', currentPriceId: 'price_school',
    })).resolves.toEqual({ status: 'retry' })
  })

  it('returns ok and does not mutate state for an unknown current price', async () => {
    const syncSubscriptionPlanChange = vi.fn()
    const logSubscriptionPlanChangeIssue = vi.fn()
    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async () => null,
      syncSubscriptionPlanChange,
      logSubscriptionPlanChangeIssue,
    }, {
      type: 'customer.subscription.updated', stripeCustomerId: 'cus_1', currentPriceId: 'price_unknown',
    })).resolves.toEqual({ status: 'ok' })
    expect(syncSubscriptionPlanChange).not.toHaveBeenCalled()
    expect(logSubscriptionPlanChangeIssue).toHaveBeenCalled()
  })

  it('clears a pending plan change when Stripe removes its schedule without applying the plan', async () => {
    const clearPendingPlanChange = vi.fn()
    const syncSubscriptionPlanChange = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async () => 'PRO',
      getPendingPlanChange: async () => ({ planId: 'SCHOOL', stripeScheduleId: 'sub_sched_1' }),
      syncSubscriptionPlanChange,
      clearPendingPlanChange,
    }, {
      type: 'customer.subscription.updated', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', currentPriceId: 'price_pro',
    })

    expect(clearPendingPlanChange).toHaveBeenCalledWith('org-1')
    expect(syncSubscriptionPlanChange).not.toHaveBeenCalled()
  })

  it('links the Stripe customer id on checkout.session.completed', async () => {
    const linkStripeCustomer = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: async () => ({ status: 'PENDING' }), markBillingRecordPaid: vi.fn(), linkStripeCustomer,
      getOrgIdForStripeCustomer: vi.fn(), setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'checkout.session.completed', clientReferenceId: 'org-1:record-1', stripeSessionId: 's', stripeCustomerId: 'cus_1' })
    expect(linkStripeCustomer).toHaveBeenCalledWith('org-1', 'cus_1')
  })

  it('marks the subscription ACTIVE and records a new PAID billing record on invoice.paid', async () => {
    const applyInvoiceLifecycle = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async (id) => { expect(id).toBe('cus_1'); return 'org-1' },
      setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(applyInvoiceLifecycle).toHaveBeenCalledWith('org-1', 'in_1', 'ACTIVE', 'PAID')
  })

  it('marks the subscription PAST_DUE and records OVERDUE on invoice.payment_failed', async () => {
    const applyInvoiceLifecycle = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle,
    }, { type: 'invoice.payment_failed', invoiceId: 'in_2', stripeCustomerId: 'cus_1' })
    expect(applyInvoiceLifecycle).toHaveBeenCalledWith('org-1', 'in_2', 'PAST_DUE', 'OVERDUE')
  })

  it('recovers an overdue invoice to PAID and keeps a repeated paid event idempotent', async () => {
    let subscriptionStatus: 'ACTIVE' | 'PAST_DUE' | undefined
    let billingRecordStatus: 'PAID' | 'OVERDUE' | undefined
    const transitions: Array<{ subscriptionStatus: 'ACTIVE' | 'PAST_DUE'; billingRecordStatus: 'PAID' | 'OVERDUE' }> = []
    const applyInvoiceLifecycle = vi.fn(async (
      _orgId: string,
      _invoiceId: string,
      nextSubscriptionStatus: 'ACTIVE' | 'PAST_DUE',
      nextBillingRecordStatus: 'PAID' | 'OVERDUE',
    ) => {
      if (!billingRecordStatus || (billingRecordStatus === 'OVERDUE' && nextBillingRecordStatus === 'PAID')) {
        subscriptionStatus = nextSubscriptionStatus
        billingRecordStatus = nextBillingRecordStatus
        transitions.push({ subscriptionStatus: nextSubscriptionStatus, billingRecordStatus: nextBillingRecordStatus })
      }
    })
    const deps = {
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', applyInvoiceLifecycle,
    }

    await handleStripeWebhookEvent(deps, { type: 'invoice.payment_failed', invoiceId: 'in_recovered', stripeCustomerId: 'cus_1' })
    await handleStripeWebhookEvent(deps, { type: 'invoice.paid', invoiceId: 'in_recovered', stripeCustomerId: 'cus_1' })
    await handleStripeWebhookEvent(deps, { type: 'invoice.paid', invoiceId: 'in_recovered', stripeCustomerId: 'cus_1' })

    expect(subscriptionStatus).toBe('ACTIVE')
    expect(billingRecordStatus).toBe('PAID')
    expect(transitions).toEqual([
      { subscriptionStatus: 'PAST_DUE', billingRecordStatus: 'OVERDUE' },
      { subscriptionStatus: 'ACTIVE', billingRecordStatus: 'PAID' },
    ])
  })

  it('marks the subscription CANCELED on customer.subscription.deleted', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, applyInvoiceLifecycle: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_1' })
    expect(setSubscriptionStatus).toHaveBeenCalledWith('org-1', 'CANCELED')
  })

  it('does nothing when the Stripe customer id cannot be resolved to an organization', async () => {
    const setSubscriptionStatus = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus, applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('logs an unresolved Stripe customer id without processing the invoice', async () => {
    const logUnresolvedStripeCustomer = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
      logUnresolvedStripeCustomer,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(logUnresolvedStripeCustomer).toHaveBeenCalledWith('cus_unknown')
  })

  it('returns a retry outcome when the reverse lookup throws, without letting the exception escape', async () => {
    const logStripeCustomerLookupError = vi.fn()
    const lookupError = new Error('Firestore unavailable')
    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => { throw lookupError }, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
      logStripeCustomerLookupError,
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })).resolves.toEqual({ status: 'retry' })
    expect(logStripeCustomerLookupError).toHaveBeenCalledWith('cus_1', lookupError)
  })

  it('returns a retry outcome for invoice.paid when the customer cannot be resolved', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(result).toEqual({ status: 'retry' })
  })

  it('returns a retry outcome for invoice.payment_failed when the customer cannot be resolved', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.payment_failed', invoiceId: 'in_1', stripeCustomerId: 'cus_unknown' })
    expect(result).toEqual({ status: 'retry' })
  })

  it('returns a retry outcome for customer.subscription.deleted when the customer cannot be resolved', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => null, setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_unknown' })
    expect(result).toEqual({ status: 'retry' })
  })

  it('returns an ok outcome for a successfully processed invoice.paid event', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus: vi.fn(), applyInvoiceLifecycle: vi.fn(),
    }, { type: 'invoice.paid', invoiceId: 'in_1', stripeCustomerId: 'cus_1' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('returns an ok outcome for a malformed checkout.session.completed event (a permanent, non-retriable mismatch)', async () => {
    const result = await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(),
    }, { type: 'checkout.session.completed', clientReferenceId: 'bad', stripeSessionId: 's' })
    expect(result).toEqual({ status: 'ok' })
  })

  it('returns an ok outcome for an unrecognized event type', async () => {
    const result = await handleStripeWebhookEvent({ getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn() }, { type: 'customer.updated' })
    expect(result).toEqual({ status: 'ok' })
  })
})

describe('sendStripeWebhookOutcome', () => {
  it('sends 503 for a retry outcome and 200 for non-retriable outcomes', () => {
    const retrySend = vi.fn()
    const okSend = vi.fn()
    const retryStatus = vi.fn(() => ({ send: retrySend }))
    const okStatus = vi.fn(() => ({ send: okSend }))
    sendStripeWebhookOutcome({ status: retryStatus }, { status: 'retry' })
    sendStripeWebhookOutcome({ status: okStatus }, { status: 'ok' })
    expect(retryStatus).toHaveBeenCalledWith(503)
    expect(okStatus).toHaveBeenCalledWith(200)
    expect(retrySend).toHaveBeenCalledWith('retry')
    expect(okSend).toHaveBeenCalledWith('ok')
  })
})

describe('Firestore subscription plan-change wiring', () => {
  it('starts a 30-day grace period once and does not extend it on a repeated apply', async () => {
    const documents: Record<string, unknown> = {
      planId: 'PRO',
      pendingPlanChange: { planId: 'SCHOOL', stripeScheduleId: 'sub_sched_1' },
    }
    const updates: Record<string, unknown>[] = []
    const organizationRef = { path: 'organizations/org-1' }
    const firestore = {
      doc: vi.fn(() => organizationRef),
      runTransaction: async (operation: (transaction: {
        get: (ref: typeof organizationRef) => Promise<{ exists: boolean; get: (field: string) => unknown }>
        update: (ref: typeof organizationRef, data: Record<string, unknown>) => void
      }) => Promise<void>) => operation({
        get: async () => ({ exists: true, get: (field) => documents[field] }),
        update: (_ref, data) => {
          updates.push(data)
          for (const [key, value] of Object.entries(data)) {
            if (key === 'pendingPlanChange') delete documents.pendingPlanChange
            else documents[key] = value
          }
        },
      }),
    }
    const synchronize = createFirestoreSubscriptionPlanChangeSynchronizer(firestore as never, () => 1_000)
    const input = { kind: 'APPLY' as const, planId: 'SCHOOL', stripeSubscriptionId: 'sub_1', stripeScheduleId: 'sub_sched_1' }

    await synchronize('org-1', input)
    await synchronize('org-1', input)

    expect(updates).toHaveLength(1)
    expect(updates[0].planId).toBe('SCHOOL')
    expect((updates[0].downgradeGrace as { planId: string; startedAt: { toMillis: () => number }; endsAt: { toMillis: () => number } })).toMatchObject({
      planId: 'SCHOOL',
    })
    expect((updates[0].downgradeGrace as { startedAt: { toMillis: () => number }; endsAt: { toMillis: () => number } }).startedAt.toMillis()).toBe(1_000)
    expect((updates[0].downgradeGrace as { startedAt: { toMillis: () => number }; endsAt: { toMillis: () => number } }).endsAt.toMillis()).toBe(1_000 + 30 * 24 * 60 * 60 * 1_000)
  })
})

describe('Firestore invoice lifecycle wiring', () => {
  it('atomically creates, recovers, and deduplicates a deterministic invoice record', async () => {
    type DocumentRef = { path: string }
    type Snapshot = { exists: boolean; get: (field: string) => unknown }
    type Transaction = {
      get: (ref: DocumentRef) => Promise<Snapshot>
      set: (ref: DocumentRef, data: Record<string, unknown>) => void
      update: (ref: DocumentRef, data: Record<string, unknown>) => void
    }
    type FakeFirestore = {
      doc: (path: string) => DocumentRef
      runTransaction: <T>(operation: (transaction: Transaction) => Promise<T>) => Promise<T>
    }

    const documents = new Map<string, Record<string, unknown>>()
    const transactionOperations: string[][] = []
    const firestore: FakeFirestore = {
      doc: (path) => ({ path }),
      runTransaction: async (operation) => {
        const operations: string[] = []
        transactionOperations.push(operations)
        return operation({
          get: async (ref) => {
            operations.push(`get:${ref.path}`)
            const data = documents.get(ref.path)
            return { exists: Boolean(data), get: (field) => data?.[field] }
          },
          set: (ref, data) => {
            operations.push(`set:${ref.path}`)
            documents.set(ref.path, { ...data })
          },
          update: (ref, data) => {
            operations.push(`update:${ref.path}`)
            documents.set(ref.path, { ...documents.get(ref.path), ...data })
          },
        })
      },
    }
    const applyInvoiceLifecycle = createFirestoreInvoiceLifecycleApplier(
      firestore as unknown as AdminFirestore,
      () => '2026-08-10T00:00:00.000Z',
    )
    const organizationPath = 'organizations/org-1'
    const billingRecordPath = 'organizations/org-1/billingRecords/in_recovered'

    await applyInvoiceLifecycle('org-1', 'in_recovered', 'PAST_DUE', 'OVERDUE')
    await applyInvoiceLifecycle('org-1', 'in_recovered', 'ACTIVE', 'PAID')
    await applyInvoiceLifecycle('org-1', 'in_recovered', 'ACTIVE', 'PAID')

    expect(documents.get(organizationPath)).toEqual({ subscriptionStatus: 'ACTIVE' })
    expect(documents.get(billingRecordPath)).toEqual({
      status: 'PAID',
      paymentMethod: 'CARD',
      stripeInvoiceId: 'in_recovered',
      createdAt: '2026-08-10T00:00:00.000Z',
    })
    expect(transactionOperations).toEqual([
      [`get:${billingRecordPath}`, `update:${organizationPath}`, `set:${billingRecordPath}`],
      [`get:${billingRecordPath}`, `update:${organizationPath}`, `update:${billingRecordPath}`],
      [`get:${billingRecordPath}`],
    ])
  })
})
