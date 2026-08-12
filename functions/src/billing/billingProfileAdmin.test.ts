import { beforeEach, describe, expect, it, vi } from 'vitest'

const { docs, writes, stripeCustomers, fakeDb, reset } = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>()
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const stripeCustomers = { create: vi.fn(), update: vi.fn() }
  let hasWritten = false
  const fakeDb = {
    doc: (path: string) => ({ path }),
    runTransaction: async (fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      update: (ref: { path: string }, data: Record<string, unknown>) => void
    }) => Promise<unknown>) => fn({
      get: async (ref) => {
        if (hasWritten) throw new Error('reads after writes are forbidden')
        return { exists: docs.has(ref.path), data: () => docs.get(ref.path) }
      },
      update: (ref, data) => { hasWritten = true; writes.push({ path: ref.path, data }); docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...data }) },
    }),
  }
  return { docs, writes, stripeCustomers, fakeDb, reset: () => { hasWritten = false } }
})

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => fakeDb, FieldValue: { serverTimestamp: () => 'server-ts' } }))
vi.mock('stripe', () => ({ default: class { customers = stripeCustomers } }))
vi.mock('./stripeCheckout', () => ({ stripeSecretKey: { value: () => 'sk_test' } }))

import { saveBillingProfileWithAdminSdk } from './billingProfileAdmin'

const profile = {
  legalName: '学校法人テスト', contactName: '担当 太郎', email: 'billing@example.test',
  address: { postalCode: '100-0001', prefecture: '東京都', city: '千代田区', line1: '千代田1-1', line2: 'ビル2F' },
}

beforeEach(() => { docs.clear(); writes.splice(0); stripeCustomers.create.mockReset(); stripeCustomers.update.mockReset(); reset() })

describe('saveBillingProfileWithAdminSdk', () => {
  it('reads the organization before writing only billingProfile and stripeCustomerId, and updates an existing Stripe customer', async () => {
    docs.set('organizations/school-1', { type: 'school', stripeCustomerId: 'cus_existing', unrelated: 'keep' })
    stripeCustomers.update.mockResolvedValue({ id: 'cus_existing' })

    await expect(saveBillingProfileWithAdminSdk({ orgId: 'school-1', profile, actorUid: 'uid-1' })).resolves.toEqual({ stripeCustomerId: 'cus_existing' })

    expect(stripeCustomers.update).toHaveBeenCalledWith('cus_existing', {
      name: '学校法人テスト', email: 'billing@example.test',
      address: { postal_code: '100-0001', state: '東京都', city: '千代田区', line1: '千代田1-1', line2: 'ビル2F', country: 'JP' },
    }, { idempotencyKey: 'billing-profile:school-1' })
    expect(stripeCustomers.create).not.toHaveBeenCalled()
    expect(writes).toEqual([{ path: 'organizations/school-1', data: {
      billingProfile: { ...profile, updatedAt: 'server-ts', updatedByUid: 'uid-1' }, stripeCustomerId: 'cus_existing',
    } }])
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
  })
})
