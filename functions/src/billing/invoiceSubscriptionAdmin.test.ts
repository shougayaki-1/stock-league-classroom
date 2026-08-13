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
    billingProfile: profile,
    stripeCustomerId: 'cus_1',
    ...extra,
  })
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

    expect(reads.slice(0, 2)).toEqual(['organizations/school-1', 'planDefinitions/SCHOOL'])
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
        items: [{ price: 'price_school', quantity: 1 }],
        collection_method: 'charge_automatically',
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
      phases: [
        {
          start_date: 1_700_000_000,
          end_date: 1_800_000_000,
          items: [{ price: 'price_school', quantity: 1 }],
          collection_method: 'charge_automatically',
        },
        {
          start_date: 1_800_000_000,
          items: [{ price: 'price_school', quantity: 1 }],
          collection_method: 'send_invoice',
          invoice_settings: { days_until_due: 30 },
          metadata: { orgId: 'school-1', billingMode: 'invoice' },
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
    ['a non-school organization', { type: 'personal', billingProfile: profile, stripeCustomerId: 'cus_1' }, { stripePriceId: 'price_school' }, '請求書払いは学校組織のみ利用できます'],
    ['an incomplete billing profile', { type: 'school', billingProfile: { ...profile, email: '' }, stripeCustomerId: 'cus_1' }, { stripePriceId: 'price_school' }, '請求先プロフィールの入力内容が不正です'],
    ['a non-string customer id', { type: 'school', billingProfile: profile, stripeCustomerId: 123 }, { stripePriceId: 'price_school' }, 'Stripe Customerが登録されていません'],
    ['a SCHOOL plan without a Stripe price', { type: 'school', billingProfile: profile, stripeCustomerId: 'cus_1' }, {}, 'このプランはまだ決済に対応していません'],
  ])('rejects %s before Stripe or Firestore writes', async (_label, organization, plan, message) => {
    docs.set('organizations/school-1', organization)
    docs.set('planDefinitions/SCHOOL', plan)

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow(message)
    expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()
    expect(stripeApi.subscriptionSchedules.create).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
