import { beforeEach, describe, expect, it, vi } from 'vitest'

const { docs, writes, stripeCustomers, fakeDb, reset } = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const stripeCustomers = { create: vi.fn(), update: vi.fn() }
  let hasWritten = false
  let operationSequence = 0
  const fakeDb = {
    doc: (path: string) => ({ path }),
    collection: (_path: string) => ({
      doc: () => ({ id: `profile-operation-${++operationSequence}` }),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      update: (ref: { path: string }, data: Record<string, unknown>) => void
      set: (ref: { path: string }, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => {
      hasWritten = false
      return fn({
      get: async (ref) => {
        if (hasWritten) throw new Error('reads after writes are forbidden')
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) }
      },
      update: (ref, data) => {
        hasWritten = true
        writes.push({ path: ref.path, data })
        const next = { ...(docs.get(ref.path) ?? {}) }
        for (const [key, value] of Object.entries(data)) {
          if (value === '__delete__') delete next[key]
          else next[key] = value
        }
        docs.set(ref.path, next)
      },
        set: (ref, data) => { hasWritten = true; writes.push({ path: ref.path, data }); docs.set(ref.path, { ...data }) },
      })
    },
  }
  return {
    docs,
    writes,
    stripeCustomers,
    fakeDb,
    reset: () => { hasWritten = false; operationSequence = 0 },
  }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: { serverTimestamp: () => 'server-ts', delete: () => '__delete__' },
}))
vi.mock('stripe', () => ({ default: class { customers = stripeCustomers } }))
vi.mock('./stripeCheckout', () => ({ stripeSecretKey: { value: () => 'sk_test' } }))

import { saveBillingProfileWithAdminSdk } from './billingProfileAdmin'

const profile = {
  legalName: '学校法人テスト', contactName: '担当 太郎', email: 'billing@example.test',
  address: { postalCode: '100-0001', prefecture: '東京都', city: '千代田区', line1: '千代田1-1', line2: 'ビル2F' },
}

beforeEach(() => { docs.clear(); writes.splice(0); stripeCustomers.create.mockReset(); stripeCustomers.update.mockReset(); reset() })

describe('saveBillingProfileWithAdminSdk', () => {
  it('keeps the profile private and atomically links the updated Stripe customer in both directions', async () => {
    docs.set('organizations/school-1', {
      type: 'school',
      stripeCustomerId: 'cus_existing',
      billingProfile: { ...profile, updatedByUid: 'legacy-owner' },
      unrelated: 'keep',
    })
    stripeCustomers.update.mockResolvedValue({ id: 'cus_existing' })

    await expect(saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' })).resolves.toEqual({ stripeCustomerId: 'cus_existing' })

    expect(stripeCustomers.update).toHaveBeenCalledWith('cus_existing', {
      name: '学校法人テスト', email: 'billing@example.test',
      address: { postal_code: '100-0001', state: '東京都', city: '千代田区', line1: '千代田1-1', line2: 'ビル2F', country: 'JP' },
    }, { idempotencyKey: 'billing-profile:update:school-1:profile-operation-1' })
    expect(stripeCustomers.create).not.toHaveBeenCalled()
    expect(writes[0]).toMatchObject({
      path: 'organizations/school-1/billingPrivate/profile',
      data: { saveRequest: { status: 'CREATING', operationId: 'profile-operation-1', requestedByUid: 'uid-1' } },
    })
    expect(writes.slice(-3)).toEqual([
      { path: 'organizations/school-1', data: { stripeCustomerId: 'cus_existing', billingProfile: '__delete__' } },
      { path: 'organizations/school-1/billingPrivate/profile', data: {
        billingProfile: { ...profile, updatedAt: 'server-ts', updatedByUid: 'uid-1' },
      } },
      { path: 'stripeCustomers/cus_existing', data: { orgId: 'school-1' } },
    ])
    expect(docs.get('organizations/school-1')).not.toHaveProperty('billingProfile')
  })

  it('creates a Stripe customer when none exists', async () => {
    docs.set('organizations/school-1', { type: 'school' })
    stripeCustomers.create.mockResolvedValue({ id: 'cus_new' })

    await expect(saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' })).resolves.toEqual({ stripeCustomerId: 'cus_new' })

    expect(stripeCustomers.create).toHaveBeenCalledWith({
      name: '学校法人テスト', email: 'billing@example.test',
      address: { postal_code: '100-0001', state: '東京都', city: '千代田区', line1: '千代田1-1', line2: 'ビル2F', country: 'JP' },
    }, { idempotencyKey: 'billing-profile:school-1' })
    expect(stripeCustomers.update).not.toHaveBeenCalled()
    expect(writes[0]).toMatchObject({
      path: 'organizations/school-1/billingPrivate/profile',
      data: { saveRequest: { status: 'CREATING', operationId: 'profile-operation-1', requestedByUid: 'uid-1' } },
    })
    expect(writes.slice(-3)).toEqual([
      { path: 'organizations/school-1', data: { stripeCustomerId: 'cus_new', billingProfile: '__delete__' } },
      { path: 'organizations/school-1/billingPrivate/profile', data: {
        billingProfile: { ...profile, updatedAt: 'server-ts', updatedByUid: 'uid-1' },
      } },
      { path: 'stripeCustomers/cus_new', data: { orgId: 'school-1' } },
    ])
    expect(docs.get('stripeCustomers/cus_new')?.orgId).toBe('school-1')
  })

  it('uses a distinct retriable operation key for A to B to A profile saves', async () => {
    docs.set('organizations/school-1', { type: 'school', stripeCustomerId: 'cus_existing' })
    stripeCustomers.update.mockResolvedValue({ id: 'cus_existing' })
    const profileB = { ...profile, contactName: '別の担当者' }

    await saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' })
    await saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile: profileB, actorUid: 'uid-1' })
    await saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' })

    const keys = stripeCustomers.update.mock.calls.map((call) => call[2]?.idempotencyKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys).toEqual([
      'billing-profile:update:school-1:profile-operation-1',
      'billing-profile:update:school-1:profile-operation-2',
      'billing-profile:update:school-1:profile-operation-3',
    ])
  })

  it('reuses the reserved profile operation key after an ambiguous Stripe failure', async () => {
    docs.set('organizations/school-1', { type: 'school', stripeCustomerId: 'cus_existing' })
    stripeCustomers.update
      .mockRejectedValueOnce(new Error('Stripe unavailable'))
      .mockResolvedValueOnce({ id: 'cus_existing' })

    await expect(saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' }))
      .rejects.toThrow('Stripe unavailable')
    await expect(saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-2' }))
      .resolves.toEqual({ stripeCustomerId: 'cus_existing' })

    const keys = stripeCustomers.update.mock.calls.map((call) => call[2]?.idempotencyKey)
    expect(keys).toEqual([
      'billing-profile:update:school-1:profile-operation-1',
      'billing-profile:update:school-1:profile-operation-1',
    ])
  })

  it('rejects a non-school organization before calling Stripe or writing', async () => {
    docs.set('organizations/personal-1', { type: 'personal' })

    await expect(saveBillingProfileWithAdminSdk({ orgId: 'personal-1', profile, actorUid: 'uid-1' }))
      .rejects.toThrow('請求書払いは学校組織のみ利用できます')

    expect(stripeCustomers.create).not.toHaveBeenCalled()
    expect(stripeCustomers.update).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
