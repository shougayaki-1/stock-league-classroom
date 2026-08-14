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

const { documents, stripeApi, fakeDb, reset } = vi.hoisted(() => {
  const documents = new Map<string, Record<string, unknown>>()
  let billingRecordSequence = 0
  let invoiceRequestSequence = 0
  const stripeApi = {
    checkout: { sessions: { create: vi.fn() } },
    subscriptions: { create: vi.fn(), retrieve: vi.fn() },
    subscriptionSchedules: { create: vi.fn(), update: vi.fn() },
  }
  type Ref = { path: string; id?: string; get?: () => Promise<Snapshot> }
  type Snapshot = {
    exists: boolean
    data: () => Record<string, unknown> | undefined
    get: (field: string) => unknown
  }
  const snapshotFor = (path: string): Snapshot => {
    const data = documents.get(path)
    return { exists: data !== undefined, data: () => data, get: (field) => data?.[field] }
  }
  const versions = new Map<string, number>()
  const fakeDb = {
    doc: (path: string): Ref => ({ path, get: async () => snapshotFor(path) }),
    collection: (path: string) => ({
      doc: (): Ref => {
        const id = path.endsWith('/billingRecords')
          ? `card-record-${++billingRecordSequence}`
          : `invoice-request-${++invoiceRequestSequence}`
        return { path: `${path}/${id}`, id }
      },
    }),
    // Emulates real Firestore's optimistic-concurrency transactions: reads are
    // versioned, writes are buffered, and a commit whose reads were invalidated
    // by a concurrent transaction is retried from scratch (fresh reads/writes).
    runTransaction: async <T>(operation: (transaction: {
      get: (ref: Ref) => Promise<Snapshot>
      set: (ref: Ref, data: Record<string, unknown>) => void
      update: (ref: Ref, data: Record<string, unknown>) => void
    }) => Promise<T>): Promise<T> => {
      const maxAttempts = 20
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const readVersions = new Map<string, number>()
        const writes = new Map<string, Record<string, unknown>>()
        const transaction = {
          get: async (ref: Ref): Promise<Snapshot> => {
            if (!readVersions.has(ref.path)) readVersions.set(ref.path, versions.get(ref.path) ?? 0)
            return snapshotFor(ref.path)
          },
          set: (ref: Ref, data: Record<string, unknown>) => { writes.set(ref.path, { ...data }) },
          update: (ref: Ref, data: Record<string, unknown>) => {
            writes.set(ref.path, { ...documents.get(ref.path), ...writes.get(ref.path), ...data })
          },
        }
        const result = await operation(transaction)
        const conflicted = [...readVersions].some(([path, version]) => (versions.get(path) ?? 0) !== version)
        if (!conflicted) {
          for (const [path, data] of writes) {
            documents.set(path, data)
            versions.set(path, (versions.get(path) ?? 0) + 1)
          }
          return result
        }
        await Promise.resolve()
      }
      throw new Error('Transaction retry limit exceeded')
    },
  }
  return {
    documents,
    stripeApi,
    fakeDb,
    reset: () => { billingRecordSequence = 0; invoiceRequestSequence = 0; versions.clear() },
  }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: {
    serverTimestamp: () => 'server-ts',
    delete: () => '__delete__',
  },
}))
vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'sk_test' }),
}))
vi.mock('stripe', () => ({ default: class {
  checkout = stripeApi.checkout
  subscriptions = stripeApi.subscriptions
  subscriptionSchedules = stripeApi.subscriptionSchedules
} }))

import { startInvoiceSubscriptionWithAdminSdk } from './invoiceSubscriptionAdmin'
import { createStripeCheckoutSessionWithAdminSdk } from './stripeCheckout'

const seedReadyOrganization = (): void => {
  documents.set('organizations/school-1', {
    type: 'school',
    stripeCustomerId: 'cus_1',
  })
  documents.set('organizations/school-1/billingPrivate/profile', { billingProfile: profile })
  documents.set('planDefinitions/SCHOOL', { stripePriceId: 'price_school' })
}

beforeEach(() => {
  documents.clear()
  reset()
  stripeApi.checkout.sessions.create.mockReset()
  stripeApi.subscriptions.create.mockReset()
  stripeApi.subscriptions.retrieve.mockReset()
  stripeApi.subscriptionSchedules.create.mockReset()
  stripeApi.subscriptionSchedules.update.mockReset()
  seedReadyOrganization()
})

describe('card and invoice billing mode exclusion', () => {
  it('blocks invoice reservation while card Checkout is between Firestore reservation and Stripe finalization', async () => {
    stripeApi.checkout.sessions.create.mockImplementation(async () => {
      expect(documents.get('organizations/school-1')?.cardCheckoutReservation).toMatchObject({
        status: 'CREATING',
        billingRecordId: 'card-record-1',
      })
      await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'invoice-owner' }))
        .rejects.toThrow('カード申込の処理中は請求書払いを開始できません')
      return {
        id: 'cs_1',
        url: 'https://checkout.stripe.test/cs_1',
        expires_at: Math.floor(Date.now() / 1_000) + 1_800,
      }
    })

    await expect(createStripeCheckoutSessionWithAdminSdk({
      orgId: 'school-1',
      planId: 'SCHOOL',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    })).resolves.toEqual({ url: 'https://checkout.stripe.test/cs_1' })

    expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()
    expect(documents.get('organizations/school-1')?.cardCheckoutReservation).toMatchObject({
      status: 'PENDING',
      billingRecordId: 'card-record-1',
      stripeSessionId: 'cs_1',
    })
  })

  it('blocks card Checkout while invoice creation is between Firestore reservation and Stripe finalization', async () => {
    stripeApi.subscriptions.create.mockImplementation(async () => {
      expect(documents.get('organizations/school-1')?.invoiceSubscriptionRequest).toMatchObject({
        status: 'CREATING',
        operation: 'CREATE',
      })
      await expect(createStripeCheckoutSessionWithAdminSdk({
        orgId: 'school-1',
        planId: 'SCHOOL',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      })).rejects.toThrow('請求書払いの契約または切替予約があるためカード申込はできません')
      return { id: 'sub_invoice' }
    })

    await expect(startInvoiceSubscriptionWithAdminSdk({ orgId: 'school-1', actorUid: 'invoice-owner' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_invoice' })

    expect(stripeApi.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('lets concurrent retries finalize the same reserved Checkout session idempotently', async () => {
    stripeApi.checkout.sessions.create.mockResolvedValue({
      id: 'cs_retry',
      url: 'https://checkout.stripe.test/cs_retry',
      expires_at: Math.floor(Date.now() / 1_000) + 1_800,
    })
    const input = {
      orgId: 'school-1',
      planId: 'SCHOOL',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    }

    await expect(Promise.all([
      createStripeCheckoutSessionWithAdminSdk(input),
      createStripeCheckoutSessionWithAdminSdk(input),
    ])).resolves.toEqual([
      { url: 'https://checkout.stripe.test/cs_retry' },
      { url: 'https://checkout.stripe.test/cs_retry' },
    ])

    expect(stripeApi.checkout.sessions.create).toHaveBeenCalledTimes(2)
    expect(stripeApi.checkout.sessions.create.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: 'stripe-checkout:school-1:card-record-1',
    })
    expect(stripeApi.checkout.sessions.create.mock.calls[1]?.[1]).toEqual({
      idempotencyKey: 'stripe-checkout:school-1:card-record-1',
    })
  })
})
