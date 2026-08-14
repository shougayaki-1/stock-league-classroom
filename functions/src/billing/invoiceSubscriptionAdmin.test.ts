import { beforeEach, describe, expect, it, vi } from 'vitest'

const profile = {
  legalName: '学校法人テスト',
  contactName: '担当 太郎',
  email: 'billing@example.test',
  address: {
    postalCode: '100-0001',
    prefecture: '東京都',
    city: '千代田区',
    line1: '千代田1-1',
  },
}

const { docs, reads, writes, stripeApi, fakeDb, resetTransaction } = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const reads: string[] = []
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  let hasWritten = false
  const stripeApi = {
    subscriptions: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn(),
    },
    subscriptionSchedules: { create: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    refunds: { create: vi.fn() },
  }
  const fakeDb = {
    doc: (path: string) => ({ path }),
    collection: (path: string) => ({
      doc: () => ({ path: `${path}/request-1`, id: 'request-1' }),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { path: string }) => Promise<{
        exists: boolean
        data: () => Record<string, unknown> | undefined
        get: (field: string) => unknown
      }>
      update: (ref: { path: string }, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => {
      hasWritten = false
      return fn({
        get: async (ref) => {
          if (hasWritten) throw new Error('reads after writes are forbidden')
          reads.push(ref.path)
          const data = docs.get(ref.path)
          return {
            exists: data !== undefined,
            data: () => data,
            get: (field) => data?.[field],
          }
        },
        update: (ref, data) => {
          hasWritten = true
          writes.push({ path: ref.path, data })
          docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data })
        },
      })
    },
  }
  return {
    docs,
    reads,
    writes,
    stripeApi,
    fakeDb,
    resetTransaction: () => { hasWritten = false },
  }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: { serverTimestamp: () => 'server-ts' },
}))
vi.mock('stripe', () => ({ default: class {
  subscriptions = stripeApi.subscriptions
  subscriptionSchedules = stripeApi.subscriptionSchedules
  refunds = stripeApi.refunds
} }))
vi.mock('./stripeCheckout', () => ({ stripeSecretKey: { value: () => 'sk_test' } }))

import { startInvoiceSubscriptionWithAdminSdk } from './invoiceSubscriptionAdmin'

const seedReadyOrganization = (extra: Record<string, unknown> = {}): void => {
  docs.set('organizations/school-1', {
    type: 'school',
    stripeCustomerId: 'cus_1',
    ...extra,
  })
  docs.set('organizations/school-1/billingPrivate/profile', { billingProfile: profile })
  docs.set('planDefinitions/SCHOOL', { stripePriceId: 'price_school' })
}

beforeEach(() => {
  docs.clear()
  reads.splice(0)
  writes.splice(0)
  resetTransaction()
  for (const resource of Object.values(stripeApi)) {
    for (const method of Object.values(resource)) method.mockReset()
  }
})

describe('startInvoiceSubscriptionWithAdminSdk', () => {
  it('reads organization, SCHOOL plan, and marker before reserving and creates the exact invoice subscription', async () => {
    seedReadyOrganization()
    stripeApi.subscriptions.create.mockResolvedValue({ id: 'sub_invoice' })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_invoice' })

    expect(reads.slice(0, 3)).toEqual([
      'organizations/school-1',
      'organizations/school-1/billingPrivate/profile',
      'planDefinitions/SCHOOL',
    ])
    expect(writes[0]).toEqual({
      path: 'organizations/school-1',
      data: {
        invoiceSubscriptionRequest: {
          idempotencyKey: 'invoice-subscription:school-1:request-1',
          status: 'CREATING',
          requestedByUid: 'uid-1',
          requestedAt: 'server-ts',
        },
      },
    })
    expect(stripeApi.subscriptions.create).toHaveBeenCalledWith({
      customer: 'cus_1',
      items: [{ price: 'price_school', quantity: 1 }],
      collection_method: 'send_invoice',
      days_until_due: 30,
      metadata: { orgId: 'school-1', billingMode: 'invoice' },
    }, { idempotencyKey: 'invoice-subscription:school-1:request-1' })
    expect(writes.at(-1)).toEqual({
      path: 'organizations/school-1',
      data: {
        invoiceSubscriptionRequest: {
          idempotencyKey: 'invoice-subscription:school-1:request-1',
          status: 'ACTIVE',
          requestedByUid: 'uid-1',
          requestedAt: 'server-ts',
          stripeSubscriptionId: 'sub_invoice',
        },
      },
    })
  })

  it('converts the current Stripe period end to milliseconds and schedules invoice billing without mutating the card subscription', async () => {
    seedReadyOrganization({
      stripeSubscriptionState: {
        subscriptionId: 'sub_card',
        status: 'active',
        eventCreatedAtMillis: 1_700_000_000_000,
      },
    })
    stripeApi.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_card',
      customer: 'cus_1',
      status: 'active',
      current_period_end: 1_800_000_000,
      collection_method: 'charge_automatically',
      items: { data: [{ price: { id: 'price_school' }, quantity: 1 }] },
    })
    stripeApi.subscriptionSchedules.create.mockResolvedValue({
      id: 'sub_sched_invoice',
      phases: [{
        start_date: 1_700_000_000,
        end_date: 1_800_000_000,
        add_invoice_items: [{
          price: { id: 'price_setup' },
          quantity: 2,
          discounts: [{ coupon: { id: 'coupon_setup' } }],
          tax_rates: [{ id: 'txr_setup' }],
        }],
        application_fee_percent: 12.5,
        automatic_tax: {
          enabled: true,
          disabled_reason: null,
          liability: { type: 'account', account: { id: 'acct_tax' } },
        },
        billing_cycle_anchor: 'automatic',
        billing_thresholds: { amount_gte: 5_000, reset_billing_cycle_anchor: false },
        collection_method: 'charge_automatically',
        coupon: 'coupon_legacy',
        currency: 'jpy',
        default_payment_method: { id: 'pm_card' },
        default_tax_rates: [{ id: 'txr_default' }],
        description: 'Existing card term',
        discounts: [{ discount: { id: 'di_phase' } }],
        invoice_settings: {
          account_tax_ids: [{ id: 'txi_issuer' }],
          days_until_due: null,
          issuer: { type: 'account', account: { id: 'acct_issuer' } },
        },
        items: [{
          price: { id: 'price_school' },
          quantity: 1,
          billing_thresholds: { usage_gte: 10 },
          discounts: [{ promotion_code: { id: 'promo_item' } }],
          metadata: { existingItem: 'kept' },
          tax_rates: [{ id: 'txr_item' }],
        }],
        metadata: { existingPhase: 'kept' },
        on_behalf_of: { id: 'acct_on_behalf' },
        proration_behavior: 'create_prorations',
        transfer_data: { destination: { id: 'acct_destination' }, amount_percent: 75 },
        trial_end: 1_750_000_000,
      }],
    })
    stripeApi.subscriptionSchedules.update.mockResolvedValue({ id: 'sub_sched_invoice' })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({
        status: 'SCHEDULED',
        stripeScheduleId: 'sub_sched_invoice',
        currentPeriodEndMillis: 1_800_000_000_000,
      })

    expect(stripeApi.subscriptions.retrieve).toHaveBeenCalledWith('sub_card')
    expect(stripeApi.subscriptionSchedules.create).toHaveBeenCalledWith({
      from_subscription: 'sub_card',
    }, { idempotencyKey: 'invoice-subscription:school-1:request-1:schedule-create' })
    expect(stripeApi.subscriptionSchedules.update).toHaveBeenCalledWith('sub_sched_invoice', {
      end_behavior: 'release',
      proration_behavior: 'none',
      phases: [
        {
          start_date: 1_700_000_000,
          end_date: 1_800_000_000,
          add_invoice_items: [{
            price: 'price_setup',
            quantity: 2,
            discounts: [{ coupon: 'coupon_setup' }],
            tax_rates: ['txr_setup'],
          }],
          application_fee_percent: 12.5,
          automatic_tax: {
            enabled: true,
            liability: { type: 'account', account: 'acct_tax' },
          },
          billing_cycle_anchor: 'automatic',
          billing_thresholds: { amount_gte: 5_000, reset_billing_cycle_anchor: false },
          collection_method: 'charge_automatically',
          coupon: 'coupon_legacy',
          currency: 'jpy',
          default_payment_method: 'pm_card',
          default_tax_rates: ['txr_default'],
          description: 'Existing card term',
          discounts: [{ discount: 'di_phase' }],
          invoice_settings: {
            account_tax_ids: ['txi_issuer'],
            issuer: { type: 'account', account: 'acct_issuer' },
          },
          items: [{
            price: 'price_school',
            quantity: 1,
            billing_thresholds: { usage_gte: 10 },
            discounts: [{ promotion_code: 'promo_item' }],
            metadata: { existingItem: 'kept' },
            tax_rates: ['txr_item'],
          }],
          metadata: { existingPhase: 'kept' },
          on_behalf_of: 'acct_on_behalf',
          proration_behavior: 'create_prorations',
          transfer_data: { destination: 'acct_destination', amount_percent: 75 },
          trial_end: 1_750_000_000,
        },
        {
          start_date: 1_800_000_000,
          items: [{ price: 'price_school', quantity: 1 }],
          collection_method: 'send_invoice',
          invoice_settings: { days_until_due: 30 },
          metadata: { orgId: 'school-1', billingMode: 'invoice' },
          proration_behavior: 'none',
        },
      ],
      metadata: { orgId: 'school-1', billingMode: 'invoice', previousSubscriptionId: 'sub_card' },
    }, { idempotencyKey: 'invoice-subscription:school-1:request-1:schedule-update' })
    expect(writes.at(-1)?.data).toEqual({
      invoiceSubscriptionRequest: {
        idempotencyKey: 'invoice-subscription:school-1:request-1',
        status: 'SCHEDULED',
        requestedByUid: 'uid-1',
        requestedAt: 'server-ts',
        stripeScheduleId: 'sub_sched_invoice',
        currentPeriodEndMillis: 1_800_000_000_000,
      },
    })
    expect(stripeApi.subscriptions.update).not.toHaveBeenCalled()
    expect(stripeApi.subscriptions.cancel).not.toHaveBeenCalled()
    expect(stripeApi.subscriptionSchedules.cancel).not.toHaveBeenCalled()
    expect(stripeApi.refunds.create).not.toHaveBeenCalled()
  })

  it('rejects a retrieved card subscription owned by another customer before creating a schedule', async () => {
    seedReadyOrganization({
      stripeSubscriptionState: {
        subscriptionId: 'sub_card',
        status: 'active',
        eventCreatedAtMillis: 1_700_000_000_000,
      },
    })
    stripeApi.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_card',
      customer: { id: 'cus_other' },
      status: 'active',
      current_period_end: 1_800_000_000,
      collection_method: 'charge_automatically',
    })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow('カード契約のCustomerが請求先と一致しません')

    expect(stripeApi.subscriptionSchedules.create).not.toHaveBeenCalled()
    expect(stripeApi.subscriptionSchedules.update).not.toHaveBeenCalled()
  })

  it('returns a finalized marker on retry without another Stripe write', async () => {
    seedReadyOrganization({
      invoiceSubscriptionRequest: {
        idempotencyKey: 'invoice-subscription:school-1:request-old',
        status: 'ACTIVE',
        requestedByUid: 'uid-old',
        stripeSubscriptionId: 'sub_existing',
      },
    })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_existing' })
    expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()
    expect(stripeApi.subscriptionSchedules.create).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('replays a CREATING reservation after a Stripe failure with the same idempotency key', async () => {
    seedReadyOrganization()
    stripeApi.subscriptions.create
      .mockRejectedValueOnce(new Error('Stripe unavailable'))
      .mockResolvedValueOnce({ id: 'sub_invoice' })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow('Stripe unavailable')
    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-2' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_invoice' })

    expect(stripeApi.subscriptions.create).toHaveBeenCalledTimes(2)
    expect(stripeApi.subscriptions.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: 'invoice-subscription:school-1:request-1',
    })
    expect(stripeApi.subscriptions.create.mock.calls[1]?.[1]).toEqual({
      idempotencyKey: 'invoice-subscription:school-1:request-1',
    })
    expect(docs.get('organizations/school-1')?.invoiceSubscriptionRequest).toEqual({
      idempotencyKey: 'invoice-subscription:school-1:request-1',
      status: 'ACTIVE',
      requestedByUid: 'uid-1',
      requestedAt: 'server-ts',
      stripeSubscriptionId: 'sub_invoice',
    })
  })

  it('does not rewrite finalization when a retry already saved the same Stripe subscription id', async () => {
    seedReadyOrganization()
    stripeApi.subscriptions.create.mockImplementation(async () => {
      docs.set('organizations/school-1', {
        ...docs.get('organizations/school-1'),
        invoiceSubscriptionRequest: {
          idempotencyKey: 'invoice-subscription:school-1:request-1',
          status: 'ACTIVE',
          requestedByUid: 'uid-1',
          requestedAt: 'server-ts',
          stripeSubscriptionId: 'sub_invoice',
        },
      })
      return { id: 'sub_invoice' }
    })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_invoice' })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.data).toEqual({
      invoiceSubscriptionRequest: {
        idempotencyKey: 'invoice-subscription:school-1:request-1',
        status: 'CREATING',
        requestedByUid: 'uid-1',
        requestedAt: 'server-ts',
      },
    })
  })

  it.each([
    ['a non-school organization', { type: 'personal', stripeCustomerId: 'cus_1' }, { billingProfile: profile }, { stripePriceId: 'price_school' }, '請求書払いは学校組織のみ利用できます'],
    ['an incomplete billing profile', { type: 'school', stripeCustomerId: 'cus_1' }, { billingProfile: { ...profile, email: '' } }, { stripePriceId: 'price_school' }, '請求先プロフィールの入力内容が不正です'],
    ['a non-string customer id', { type: 'school', stripeCustomerId: 123 }, { billingProfile: profile }, { stripePriceId: 'price_school' }, 'Stripe Customerが登録されていません'],
    ['a SCHOOL plan without a Stripe price', { type: 'school', stripeCustomerId: 'cus_1' }, { billingProfile: profile }, {}, 'このプランはまだ決済に対応していません'],
  ])('rejects %s before Stripe or Firestore writes', async (_label, organization, privateBilling, plan, message) => {
    docs.set('organizations/school-1', organization)
    docs.set('organizations/school-1/billingPrivate/profile', privateBilling)
    docs.set('planDefinitions/SCHOOL', plan)

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow(message)
    expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()
    expect(stripeApi.subscriptionSchedules.create).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
