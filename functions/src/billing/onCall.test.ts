import type { CallableRequest } from 'firebase-functions/v2/https'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireActiveOrgMember } from '../organizations/authorization'
import { saveBillingProfileWithAdminSdk } from './billingProfileAdmin'
import {
  getBillingOverviewWithAdminSdk,
  startInvoiceSubscriptionWithAdminSdk,
} from './invoiceSubscriptionAdmin'
import {
  createStripeCheckoutSessionCallable,
  createStripeCustomerPortalSessionCallable,
  getBillingOverviewCallable,
  saveBillingProfileCallable,
  startInvoiceSubscriptionCallable,
} from './onCall'
import { createStripeCheckoutSessionWithAdminSdk } from './stripeCheckout'
import { createStripeCustomerPortalSessionWithAdminSdk } from './stripeCustomerPortal'

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

const { fakeDb, firestoreReads, organizationDocs, billingRecordDocs, stripeApi } = vi.hoisted(() => {
  const firestoreReads: string[] = []
  const organizationDocs = new Map<string, Record<string, unknown>>()
  const billingRecordDocs = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>()
  const fakeDb = {
    doc: (path: string) => ({
      get: async () => {
        firestoreReads.push(path)
        const data = organizationDocs.get(path)
        return {
          exists: data !== undefined,
          data: () => data,
        }
      },
    }),
    collection: (path: string) => ({
      get: async () => {
        firestoreReads.push(path)
        return {
          docs: (billingRecordDocs.get(path) ?? []).map((document) => ({
            id: document.id,
            data: () => document.data,
          })),
        }
      },
    }),
  }
  const stripeApi = { invoices: { retrieve: vi.fn() } }
  return { fakeDb, firestoreReads, organizationDocs, billingRecordDocs, stripeApi }
})

vi.mock('../organizations/authorization', () => ({ requireActiveOrgMember: vi.fn() }))
vi.mock('./billingProfileAdmin', () => ({ saveBillingProfileWithAdminSdk: vi.fn() }))
vi.mock('./invoiceSubscriptionAdmin', () => ({
  getBillingOverviewWithAdminSdk: vi.fn(),
  startInvoiceSubscriptionWithAdminSdk: vi.fn(),
}))
vi.mock('./stripeCheckout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stripeCheckout')>()),
  createStripeCheckoutSessionWithAdminSdk: vi.fn(),
}))
vi.mock('./stripeCustomerPortal', () => ({ createStripeCustomerPortalSessionWithAdminSdk: vi.fn() }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => fakeDb }))
vi.mock('stripe', () => ({ default: class {
  invoices = stripeApi.invoices
} }))

const auth = {
  uid: 'uid-owner',
  token: { email_verified: true, firebase: { sign_in_provider: 'google.com' } },
} as unknown as CallableRequest['auth']

const unverifiedAuth = {
  uid: 'uid-owner',
  token: { email_verified: false, firebase: { sign_in_provider: 'google.com' } },
} as unknown as CallableRequest['auth']

const nonGoogleAuth = {
  uid: 'uid-owner',
  token: { email_verified: true, firebase: { sign_in_provider: 'password' } },
} as unknown as CallableRequest['auth']

const callableRequest = (data: unknown, requestAuth: CallableRequest['auth'] = auth) => ({
  auth: requestAuth,
  data,
}) as unknown as CallableRequest

describe('createStripeCheckoutSessionCallable', () => {
  beforeEach(() => vi.clearAllMocks())

  const request = callableRequest({
    orgId: 'org-1',
    planId: 'SCHOOL',
    successUrl: 'https://x/s',
    cancelUrl: 'https://x/c',
  })

  it('rejects a non-manager', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(createStripeCheckoutSessionCallable.run(request)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('creates checkout for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCheckoutSessionWithAdminSdk).mockResolvedValueOnce({ url: 'https://checkout.stripe.com/x' })
    await expect(createStripeCheckoutSessionCallable.run(request)).resolves.toEqual({ url: 'https://checkout.stripe.com/x' })
  })
})

describe('createStripeCustomerPortalSessionCallable', () => {
  beforeEach(() => vi.clearAllMocks())
  const portalRequest = callableRequest({ orgId: 'org-1', returnUrl: 'https://x/return' })

  it('rejects a non-manager', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a null payload as invalid-argument', async () => {
    await expect(createStripeCustomerPortalSessionCallable.run(callableRequest(null))).rejects.toMatchObject({
      code: 'invalid-argument',
    })
  })

  it('creates a portal session for an owner', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCustomerPortalSessionWithAdminSdk).mockResolvedValueOnce({ url: 'https://billing.stripe.com/p/x' })
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).resolves.toEqual({
      url: 'https://billing.stripe.com/p/x',
    })
  })

  it('translates a missing stripeCustomerId into failed-precondition', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'owner', membershipVersion: 1 })
    vi.mocked(createStripeCustomerPortalSessionWithAdminSdk).mockRejectedValueOnce(new Error('まだ決済履歴がありません'))
    await expect(createStripeCustomerPortalSessionCallable.run(portalRequest)).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })
})

describe('invoice billing Callables', () => {
  const handlers = [
    {
      name: 'saveBillingProfileCallable',
      handler: saveBillingProfileCallable,
      data: { orgId: 'school-1', profile },
    },
    {
      name: 'startInvoiceSubscriptionCallable',
      handler: startInvoiceSubscriptionCallable,
      data: { orgId: 'school-1' },
    },
    {
      name: 'getBillingOverviewCallable',
      handler: getBillingOverviewCallable,
      data: { orgId: 'school-1' },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireActiveOrgMember).mockResolvedValue({ role: 'owner', membershipVersion: 1 })
    vi.mocked(saveBillingProfileWithAdminSdk).mockResolvedValue({ stripeCustomerId: 'cus_1' })
    vi.mocked(startInvoiceSubscriptionWithAdminSdk).mockResolvedValue({
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    })
    vi.mocked(getBillingOverviewWithAdminSdk).mockResolvedValue({
      profile,
      paymentMethod: 'INVOICE',
      invoices: [],
    })
  })

  for (const { name, handler, data } of handlers) {
    it(`${name} rejects an unauthenticated caller`, async () => {
      await expect(handler.run({ auth: undefined, data } as unknown as CallableRequest)).rejects.toMatchObject({
        code: 'unauthenticated',
      })
    })

    it.each([
      ['unverified', unverifiedAuth],
      ['non-Google', nonGoogleAuth],
    ])(`${name} rejects a %s identity`, async (_label, invalidAuth) => {
      await expect(handler.run(callableRequest(data, invalidAuth))).rejects.toMatchObject({ code: 'permission-denied' })
      expect(requireActiveOrgMember).not.toHaveBeenCalled()
    })

    it(`${name} rejects a teacher`, async () => {
      vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'teacher', membershipVersion: 1 })
      await expect(handler.run(callableRequest(data))).rejects.toMatchObject({ code: 'permission-denied' })
    })

    it(`${name} rejects a missing payload`, async () => {
      await expect(handler.run(callableRequest(null))).rejects.toMatchObject({ code: 'invalid-argument' })
      expect(requireActiveOrgMember).not.toHaveBeenCalled()
    })

    it(`${name} binds the Stripe secret and asia-northeast1 region`, () => {
      expect(handler.__endpoint.region).toEqual(['asia-northeast1'])
      expect(handler.__endpoint.secretEnvironmentVariables).toEqual([{ key: 'STRIPE_SECRET_KEY' }])
    })
  }

  it('passes the owner UID when saving the billing profile', async () => {
    await expect(saveBillingProfileCallable.run(callableRequest({ orgId: 'school-1', profile }))).resolves.toEqual({
      stripeCustomerId: 'cus_1',
    })
    expect(requireActiveOrgMember).toHaveBeenCalledWith(fakeDb, 'school-1', 'uid-owner')
    expect(saveBillingProfileWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1',
      profile,
      actorUid: 'uid-owner',
    })
  })

  it('passes the admin UID when starting an invoice subscription', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(startInvoiceSubscriptionCallable.run(callableRequest({ orgId: 'school-1' }))).resolves.toEqual({
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    })
    expect(startInvoiceSubscriptionWithAdminSdk).toHaveBeenCalledWith({
      orgId: 'school-1',
      actorUid: 'uid-owner',
    })
  })

  it('allows an admin to read only the requested organization overview', async () => {
    vi.mocked(requireActiveOrgMember).mockResolvedValueOnce({ role: 'admin', membershipVersion: 1 })
    await expect(getBillingOverviewCallable.run(callableRequest({ orgId: 'school-1' }))).resolves.toMatchObject({
      paymentMethod: 'INVOICE',
    })
    expect(getBillingOverviewWithAdminSdk).toHaveBeenCalledWith({ orgId: 'school-1' })
  })

  it('maps an incomplete saved profile to failed-precondition when starting', async () => {
    vi.mocked(startInvoiceSubscriptionWithAdminSdk).mockRejectedValueOnce(
      new Error('請求先プロフィールの入力内容が不正です'),
    )
    await expect(startInvoiceSubscriptionCallable.run(callableRequest({ orgId: 'school-1' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })

  it.each([
    '請求書払いの申込を処理中です',
    'このプランはまだ決済に対応していません',
  ])('maps %s to failed-precondition', async (message) => {
    vi.mocked(startInvoiceSubscriptionWithAdminSdk).mockRejectedValueOnce(new Error(message))
    await expect(startInvoiceSubscriptionCallable.run(callableRequest({ orgId: 'school-1' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })

  it('maps an incomplete submitted profile to invalid-argument', async () => {
    vi.mocked(saveBillingProfileWithAdminSdk).mockRejectedValueOnce(
      new Error('請求先プロフィールの入力内容が不正です'),
    )
    await expect(saveBillingProfileCallable.run(callableRequest({
      orgId: 'school-1',
      profile: { ...profile, legalName: '' },
    }))).rejects.toMatchObject({ code: 'invalid-argument' })
  })

  it.each([
    ['save', saveBillingProfileCallable, saveBillingProfileWithAdminSdk, { orgId: 'parent-1', profile }],
    ['start', startInvoiceSubscriptionCallable, startInvoiceSubscriptionWithAdminSdk, { orgId: 'parent-1' }],
    ['overview', getBillingOverviewCallable, getBillingOverviewWithAdminSdk, { orgId: 'parent-1' }],
  ] as const)('rejects a non-school organization from %s', async (_name, handler, adapter, data) => {
    vi.mocked(adapter).mockRejectedValueOnce(new Error('請求書払いは学校組織のみ利用できます'))
    await expect(handler.run(callableRequest(data))).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it.each([
    ['save', saveBillingProfileCallable, saveBillingProfileWithAdminSdk, { orgId: 'school-1', profile }],
    ['start', startInvoiceSubscriptionCallable, startInvoiceSubscriptionWithAdminSdk, { orgId: 'school-1' }],
    ['overview', getBillingOverviewCallable, getBillingOverviewWithAdminSdk, { orgId: 'school-1' }],
  ] as const)('maps a Stripe outage from %s to unavailable', async (_name, handler, adapter, data) => {
    vi.mocked(adapter).mockRejectedValueOnce(new Error('Stripe outage'))
    await expect(handler.run(callableRequest(data))).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('getBillingOverviewWithAdminSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = 'sk_test'
    firestoreReads.splice(0)
    organizationDocs.clear()
    billingRecordDocs.clear()
  })

  it('returns only Stripe Invoice records owned by the organization', async () => {
    organizationDocs.set('organizations/school-1', {
      type: 'school',
      stripeCustomerId: 'cus_school',
      billingProfile: {
        ...profile,
        updatedAt: 'server-time',
        updatedByUid: 'uid-owner',
      },
      invoiceSubscriptionRequest: {
        status: 'ACTIVE',
        idempotencyKey: 'secret-idempotency-key',
        requestedByUid: 'uid-owner',
        stripeSubscriptionId: 'sub_invoice',
      },
    })
    billingRecordDocs.set('organizations/school-1/billingRecords', [
      {
        id: 'in_other_customer',
        data: {
          status: 'PAID',
          paymentMethod: 'BANK_TRANSFER',
          dueDateMillis: 1_700_000_000_000,
          stripeInvoiceId: 'in_other_customer',
        },
      },
      {
        id: 'in_1',
        data: {
          status: 'PENDING',
          paymentMethod: 'INVOICE',
          dueDateMillis: 1_800_000_000_000,
          stripeInvoiceId: 'in_1',
          hostedInvoiceUrl: 'https://stored.example/never-return-this',
          stripeCustomerId: 'cus_secret',
          updatedByUid: 'uid-owner',
        },
      },
      {
        id: 'card-record',
        data: {
          status: 'PAID',
          paymentMethod: 'CARD',
          createdAt: 'earlier',
        },
      },
    ])
    stripeApi.invoices.retrieve.mockResolvedValueOnce({
      id: 'in_other_customer',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_other_customer',
      customer: 'cus_other',
    }).mockResolvedValueOnce({
      id: 'in_1',
      hosted_invoice_url: 'https://invoice.stripe.com/i/in_1',
      customer: 'cus_school',
    })

    const actual = await vi.importActual<typeof import('./invoiceSubscriptionAdmin')>('./invoiceSubscriptionAdmin')
    await expect(actual.getBillingOverviewWithAdminSdk({ orgId: 'school-1' })).resolves.toEqual({
      profile,
      paymentMethod: 'INVOICE',
      invoiceSubscription: { status: 'ACTIVE' },
      invoices: [{
        id: 'in_1',
        status: 'PENDING',
        paymentMethod: 'INVOICE',
        dueDateMillis: 1_800_000_000_000,
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
      }],
    })
    expect(firestoreReads).toEqual([
      'organizations/school-1',
      'organizations/school-1/billingRecords',
    ])
    expect(stripeApi.invoices.retrieve).toHaveBeenNthCalledWith(1, 'in_other_customer')
    expect(stripeApi.invoices.retrieve).toHaveBeenNthCalledWith(2, 'in_1')
  })

  it('rejects a non-school organization before retrieving Stripe Invoices', async () => {
    organizationDocs.set('organizations/parent-1', { type: 'parentOrg' })
    billingRecordDocs.set('organizations/parent-1/billingRecords', [])

    const actual = await vi.importActual<typeof import('./invoiceSubscriptionAdmin')>('./invoiceSubscriptionAdmin')
    await expect(actual.getBillingOverviewWithAdminSdk({ orgId: 'parent-1' }))
      .rejects.toThrow('請求書払いは学校組織のみ利用できます')
    expect(stripeApi.invoices.retrieve).not.toHaveBeenCalled()
  })
})
