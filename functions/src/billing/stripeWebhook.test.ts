import { describe, expect, it, vi } from 'vitest'
import { Timestamp, type Firestore as AdminFirestore } from 'firebase-admin/firestore'
import type Stripe from 'stripe'
import {
  createFirestoreInvoiceLifecycleApplier,
  createFirestoreInvoiceBillingRecordSynchronizer,
  createFirestoreStripeSubscriptionStateSynchronizer,
  createFirestoreSubscriptionPlanChangeSynchronizer,
  extractStripeWebhookEvent,
  handleStripeWebhookEvent,
  sendStripeWebhookOutcome,
} from './stripeWebhook'
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

  it('synchronizes a parent subscription deletion as ENDED', async () => {
    const syncStripeSubscriptionState = vi.fn()

    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      syncStripeSubscriptionState,
    }, {
      type: 'customer.subscription.deleted',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      eventCreatedAtMillis: 200,
    })).resolves.toEqual({ status: 'ok' })

    expect(syncStripeSubscriptionState).toHaveBeenCalledWith('org-1', {
      subscriptionId: 'sub_1',
      status: 'canceled',
      eventCreatedAtMillis: 200,
    }, 'ENDED')
  })

  it('synchronizes a newer parent active event before unknown current-price handling', async () => {
    const syncStripeSubscriptionState = vi.fn()
    const logSubscriptionPlanChangeIssue = vi.fn()

    await expect(handleStripeWebhookEvent({
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      getPlanIdForStripePrice: async () => null,
      syncStripeSubscriptionState,
      logSubscriptionPlanChangeIssue,
    }, {
      type: 'customer.subscription.updated',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      currentPriceId: 'price_unknown',
      status: 'active',
      eventCreatedAtMillis: 201,
    })).resolves.toEqual({ status: 'ok' })

    expect(syncStripeSubscriptionState).toHaveBeenCalledWith('org-1', {
      subscriptionId: 'sub_1',
      status: 'active',
      eventCreatedAtMillis: 201,
    }, 'ACTIVE')
    expect(logSubscriptionPlanChangeIssue).toHaveBeenCalled()
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

  it('never invokes subscription-state sync for invoice lifecycle events', async () => {
    const syncStripeSubscriptionState = vi.fn()

    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      applyInvoiceLifecycle: vi.fn(),
      syncStripeSubscriptionState,
    }, {
      type: 'invoice.paid',
      invoiceId: 'in_1',
      stripeCustomerId: 'cus_1',
    })

    expect(syncStripeSubscriptionState).not.toHaveBeenCalled()
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

  it('does not bypass ordered subscription-state synchronization on customer.subscription.deleted', async () => {
    const setSubscriptionStatus = vi.fn()
    const syncStripeSubscriptionState = vi.fn()
    await handleStripeWebhookEvent({
      getBillingRecord: vi.fn(), markBillingRecordPaid: vi.fn(), linkStripeCustomer: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1', setSubscriptionStatus, syncStripeSubscriptionState, applyInvoiceLifecycle: vi.fn(),
    }, { type: 'customer.subscription.deleted', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', eventCreatedAtMillis: 200 })
    expect(syncStripeSubscriptionState).toHaveBeenCalled()
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
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

describe('Firestore subscription-state wiring', () => {
  it('ignores an older event and keeps the saved state unchanged', async () => {
    type DocumentRef = { path: string }
    type Snapshot = { exists: boolean; get: (field: string) => unknown }
    type Transaction = {
      get: (ref: DocumentRef) => Promise<Snapshot>
      update: (ref: DocumentRef, data: Record<string, unknown>) => void
    }
    type FakeFirestore = {
      doc: (path: string) => DocumentRef
      runTransaction: <T>(operation: (transaction: Transaction) => Promise<T>) => Promise<T>
    }

    const documents = new Map<string, Record<string, unknown>>([
      ['organizations/org-1', {
        type: 'parentOrg',
        stripeSubscriptionState: { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
        parentContractState: 'ENDED',
        parentContractSubscriptionId: 'sub_1',
        parentContractEventCreatedAtMillis: 200,
        parentContractEndedAt: 'OLD_END',
      }],
    ])
    const transactionOperations: string[][] = []
    const firestore: FakeFirestore = {
      doc: (path) => ({ path }),
      runTransaction: async (operation) => {
        const operations: string[] = []
        transactionOperations.push(operations)
        let wrote = false
        return operation({
          get: async (ref) => {
            if (wrote) throw new Error('Firestore transactions require all reads before writes')
            operations.push(`get:${ref.path}`)
            const data = documents.get(ref.path)
            return { exists: Boolean(data), get: (field) => data?.[field] }
          },
          update: (ref, data) => {
            wrote = true
            operations.push(`update:${ref.path}`)
            const next = { ...documents.get(ref.path) }
            for (const [key, value] of Object.entries(data)) {
              if (value?.constructor?.name === 'DeleteTransform') delete next[key]
              else if (value?.constructor?.name === 'ServerTimestampTransform') next[key] = 'SERVER_TIMESTAMP'
              else next[key] = value
            }
            documents.set(ref.path, next)
          },
        })
      },
    }

    const synchronize = createFirestoreStripeSubscriptionStateSynchronizer(firestore as unknown as AdminFirestore)

    await synchronize('org-1', {
      subscriptionId: 'sub_1',
      status: 'active',
      eventCreatedAtMillis: 199,
    }, 'ACTIVE')

    expect(transactionOperations).toEqual([['get:organizations/org-1']])
    expect(documents.get('organizations/org-1')).toEqual({
      type: 'parentOrg',
      stripeSubscriptionState: { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
      parentContractState: 'ENDED',
      parentContractSubscriptionId: 'sub_1',
      parentContractEventCreatedAtMillis: 200,
      parentContractEndedAt: 'OLD_END',
    })
  })

  it('removes parentContractEndedAt on a newer parent ACTIVE event without touching child-school fields', async () => {
    type DocumentRef = { path: string }
    type Snapshot = { exists: boolean; get: (field: string) => unknown }
    type Transaction = {
      get: (ref: DocumentRef) => Promise<Snapshot>
      update: (ref: DocumentRef, data: Record<string, unknown>) => void
    }
    type FakeFirestore = {
      doc: (path: string) => DocumentRef
      runTransaction: <T>(operation: (transaction: Transaction) => Promise<T>) => Promise<T>
    }

    const documents = new Map<string, Record<string, unknown>>([
      ['organizations/org-1', {
        type: 'parentOrg',
        childSchoolCount: 3,
        stripeSubscriptionState: { subscriptionId: 'sub_1', status: 'canceled', eventCreatedAtMillis: 200 },
        parentContractState: 'ENDED',
        parentContractSubscriptionId: 'sub_1',
        parentContractEventCreatedAtMillis: 200,
        parentContractEndedAt: 'OLD_END',
      }],
    ])
    const transactionOperations: string[][] = []
    const firestore: FakeFirestore = {
      doc: (path) => ({ path }),
      runTransaction: async (operation) => {
        const operations: string[] = []
        transactionOperations.push(operations)
        let wrote = false
        return operation({
          get: async (ref) => {
            if (wrote) throw new Error('Firestore transactions require all reads before writes')
            operations.push(`get:${ref.path}`)
            const data = documents.get(ref.path)
            return { exists: Boolean(data), get: (field) => data?.[field] }
          },
          update: (ref, data) => {
            wrote = true
            operations.push(`update:${ref.path}`)
            const next = { ...documents.get(ref.path) }
            for (const [key, value] of Object.entries(data)) {
              if (value?.constructor?.name === 'DeleteTransform') delete next[key]
              else if (value?.constructor?.name === 'ServerTimestampTransform') next[key] = 'SERVER_TIMESTAMP'
              else next[key] = value
            }
            documents.set(ref.path, next)
          },
        })
      },
    }

    const synchronize = createFirestoreStripeSubscriptionStateSynchronizer(firestore as unknown as AdminFirestore)

    await synchronize('org-1', {
      subscriptionId: 'sub_1',
      status: 'active',
      eventCreatedAtMillis: 201,
    }, 'ACTIVE')

    expect(transactionOperations).toEqual([['get:organizations/org-1', 'update:organizations/org-1']])
    expect(documents.get('organizations/org-1')).toEqual({
      type: 'parentOrg',
      childSchoolCount: 3,
      subscriptionStatus: 'ACTIVE',
      stripeSubscriptionState: { subscriptionId: 'sub_1', status: 'active', eventCreatedAtMillis: 201 },
      parentContractState: 'ACTIVE',
      parentContractSubscriptionId: 'sub_1',
      parentContractEventCreatedAtMillis: 201,
    })
  })

  it('stores the subscription state for a school without writing parent-contract fields', async () => {
    type DocumentRef = { path: string }
    type Snapshot = { exists: boolean; get: (field: string) => unknown }
    type Transaction = {
      get: (ref: DocumentRef) => Promise<Snapshot>
      update: (ref: DocumentRef, data: Record<string, unknown>) => void
    }
    type FakeFirestore = {
      doc: (path: string) => DocumentRef
      runTransaction: <T>(operation: (transaction: Transaction) => Promise<T>) => Promise<T>
    }

    const documents = new Map<string, Record<string, unknown>>([
      ['organizations/school-1', {
        type: 'school',
        parentOrgId: 'parent-1',
      }],
    ])
    const firestore: FakeFirestore = {
      doc: (path) => ({ path }),
      runTransaction: async (operation) => operation({
        get: async (ref) => {
          const data = documents.get(ref.path)
          return { exists: Boolean(data), get: (field) => data?.[field] }
        },
        update: (ref, data) => {
          const next = { ...documents.get(ref.path), ...data }
          documents.set(ref.path, next)
        },
      }),
    }

    const synchronize = createFirestoreStripeSubscriptionStateSynchronizer(firestore as unknown as AdminFirestore)

    await synchronize('school-1', {
      subscriptionId: 'sub_2',
      status: 'canceled',
      eventCreatedAtMillis: 300,
    }, 'ENDED')

    expect(documents.get('organizations/school-1')).toEqual({
      type: 'school',
      parentOrgId: 'parent-1',
      subscriptionStatus: 'CANCELED',
      stripeSubscriptionState: { subscriptionId: 'sub_2', status: 'canceled', eventCreatedAtMillis: 300 },
    })
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

describe('Stripe Invoicing invoice lifecycle', () => {
  it('forwards every invoice lifecycle event to the invoice synchronizer without invoking subscription-state sync', async () => {
    const syncInvoiceBillingRecord = vi.fn()
    const syncStripeSubscriptionState = vi.fn()
    const deps = {
      getBillingRecord: vi.fn(),
      markBillingRecordPaid: vi.fn(),
      getOrgIdForStripeCustomer: async () => 'org-1',
      syncInvoiceBillingRecord,
      syncStripeSubscriptionState,
    }
    const events = [
      { type: 'invoice.finalized' as const, eventCreatedAtMillis: 100 },
      { type: 'invoice.sent' as const, eventCreatedAtMillis: 200 },
      { type: 'invoice.paid' as const, eventCreatedAtMillis: 300 },
      { type: 'invoice.payment_failed' as const, eventCreatedAtMillis: 400 },
      { type: 'invoice.voided' as const, eventCreatedAtMillis: 500 },
    ]

    for (const event of events) {
      await expect(handleStripeWebhookEvent(deps, {
        ...event,
        invoiceId: 'in_1',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        dueDateMillis: 9_999,
        paymentMethod: 'INVOICE',
      })).resolves.toEqual({ status: 'ok' })
    }

    expect(syncInvoiceBillingRecord).toHaveBeenCalledTimes(5)
    expect(syncInvoiceBillingRecord).toHaveBeenLastCalledWith('org-1', {
      type: 'invoice.voided', invoiceId: 'in_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
      dueDateMillis: 9_999, paymentMethod: 'INVOICE', eventCreatedAtMillis: 500,
    })
    expect(syncStripeSubscriptionState).not.toHaveBeenCalled()
  })

  it('extracts BANK_TRANSFER only from paid invoices with a bank-transfer payment detail', () => {
    const bankTransfer = extractStripeWebhookEvent({
      type: 'invoice.paid',
      created: 123,
      data: { object: {
        id: 'in_bank', customer: 'cus_1', subscription: 'sub_1', due_date: 456, collection_method: 'send_invoice',
        payment_settings: {
          payment_method_options: { customer_balance: { bank_transfer: { type: 'jp_bank_transfer' } } },
        },
      } },
    } as unknown as Stripe.Event)
    const configuredButUnpaid = extractStripeWebhookEvent({
      type: 'invoice.finalized',
      created: 124,
      data: { object: {
        id: 'in_pending', customer: 'cus_1', subscription: 'sub_1', due_date: 457, collection_method: 'send_invoice',
        payment_settings: {
          payment_method_options: { customer_balance: { bank_transfer: { type: 'jp_bank_transfer' } } },
        },
      } },
    } as unknown as Stripe.Event)
    const paidWithoutBankDetail = extractStripeWebhookEvent({
      type: 'invoice.paid',
      created: 125,
      data: { object: {
        id: 'in_invoice', customer: 'cus_1', subscription: 'sub_1', due_date: 458, collection_method: 'send_invoice',
        payment_settings: { payment_method_options: { customer_balance: { funding_type: 'bank_transfer' } } },
      } },
    } as unknown as Stripe.Event)

    expect(bankTransfer).toMatchObject({ type: 'invoice.paid', paymentMethod: 'BANK_TRANSFER', eventCreatedAtMillis: 123_000 })
    expect(configuredButUnpaid).toMatchObject({ type: 'invoice.finalized', paymentMethod: 'INVOICE' })
    expect(paidWithoutBankDetail).toMatchObject({ type: 'invoice.paid', paymentMethod: 'INVOICE' })
  })

  it('creates ordered Invoice records without changing plan or parent-contract fields', async () => {
    type DocumentRef = { path: string }
    type Snapshot = { exists: boolean; get: (field: string) => unknown }
    type Transaction = {
      get: (ref: DocumentRef) => Promise<Snapshot>
      set: (ref: DocumentRef, data: Record<string, unknown>) => void
      update: (ref: DocumentRef, data: Record<string, unknown>) => void
    }
    const documents = new Map<string, Record<string, unknown>>([
      ['organizations/org-1', {
        planId: 'SCHOOL', parentContractState: 'ACTIVE', parentContractSubscriptionId: 'sub_parent',
      }],
    ])
    const transactionOperations: string[][] = []
    const firestore = {
      doc: (path: string): DocumentRef => ({ path }),
      runTransaction: async <T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> => {
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
    const syncInvoiceBillingRecord = createFirestoreInvoiceBillingRecordSynchronizer(firestore as unknown as AdminFirestore)
    const invoice = {
      invoiceId: 'in_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', dueDateMillis: 9_999,
      paymentMethod: 'INVOICE' as const,
    }

    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.finalized', eventCreatedAtMillis: 100 })
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.sent', eventCreatedAtMillis: 200 })
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.payment_failed', eventCreatedAtMillis: 300 })
    expect(documents.get('organizations/org-1/billingRecords/in_1')?.status).toBe('OVERDUE')
    expect(documents.get('organizations/org-1')?.subscriptionStatus).toBe('PAST_DUE')
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.paid', eventCreatedAtMillis: 400, paymentMethod: 'BANK_TRANSFER' })
    expect(documents.get('organizations/org-1/billingRecords/in_1')?.status).toBe('PAID')
    expect(documents.get('organizations/org-1/billingRecords/in_1')?.paymentMethod).toBe('BANK_TRANSFER')
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.payment_failed', eventCreatedAtMillis: 399 })
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.voided', eventCreatedAtMillis: 500 })
    await syncInvoiceBillingRecord('org-1', { ...invoice, type: 'invoice.sent', eventCreatedAtMillis: 500 })

    expect(documents.get('organizations/org-1')).toEqual({
      planId: 'SCHOOL', parentContractState: 'ACTIVE', parentContractSubscriptionId: 'sub_parent', subscriptionStatus: 'ACTIVE',
    })
    const billingRecord = documents.get('organizations/org-1/billingRecords/in_1')
    expect(billingRecord).toMatchObject({
      status: 'CANCELLED', paymentMethod: 'INVOICE', stripeInvoiceId: 'in_1', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', dueDateMillis: 9_999, lastStripeEventCreatedAtMillis: 500,
    })
    expect(billingRecord?.finalizedAt).toEqual(Timestamp.fromMillis(100))
    expect(billingRecord?.sentAt).toEqual(Timestamp.fromMillis(200))
    expect(billingRecord?.overdueAt).toEqual(Timestamp.fromMillis(300))
    expect(billingRecord?.paidAt).toEqual(Timestamp.fromMillis(400))
    expect(billingRecord?.cancelledAt).toEqual(Timestamp.fromMillis(500))
    expect(transactionOperations).toEqual([
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1', 'set:organizations/org-1/billingRecords/in_1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1/billingRecords/in_1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1', 'update:organizations/org-1/billingRecords/in_1'],
      ['get:organizations/org-1', 'get:organizations/org-1/billingRecords/in_1'],
    ])
  })
})
