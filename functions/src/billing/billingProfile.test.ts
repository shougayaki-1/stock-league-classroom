import { describe, expect, it, vi } from 'vitest'
import { saveBillingProfile, validateBillingProfile } from './billingProfile'

const validProfile = {
  legalName: ' 学校法人テスト ',
  contactName: ' 担当 太郎 ',
  email: ' billing@example.test ',
  address: {
    postalCode: ' 100-0001 ', prefecture: ' 東京都 ', city: ' 千代田区 ', line1: ' 千代田1-1 ', line2: '   ',
  },
}

describe('validateBillingProfile', () => {
  it.each([
    ['legalName', { ...validProfile, legalName: '   ' }],
    ['contactName', { ...validProfile, contactName: '   ' }],
    ['email', { ...validProfile, email: '   ' }],
    ['postalCode', { ...validProfile, address: { ...validProfile.address, postalCode: '   ' } }],
    ['prefecture', { ...validProfile, address: { ...validProfile.address, prefecture: '   ' } }],
    ['city', { ...validProfile, address: { ...validProfile.address, city: '   ' } }],
    ['line1', { ...validProfile, address: { ...validProfile.address, line1: '   ' } }],
    ['email without @', { ...validProfile, email: 'billing.example.test' }],
  ])('rejects an invalid %s', (_field, profile) => {
    expect(() => validateBillingProfile(profile)).toThrow('請求先プロフィールの入力内容が不正です')
  })

  it('trims values and omits a blank line2 without mutating the input', () => {
    expect(validateBillingProfile(validProfile)).toEqual({
      legalName: '学校法人テスト', contactName: '担当 太郎', email: 'billing@example.test',
      address: { postalCode: '100-0001', prefecture: '東京都', city: '千代田区', line1: '千代田1-1' },
    })
    expect(validProfile.address.line2).toBe('   ')
  })
})

describe('saveBillingProfile', () => {
  it('syncs a school profile with Stripe using a stable idempotency key and saves its Customer ID', async () => {
    const syncStripeCustomer = vi.fn().mockResolvedValue({ id: 'cus_school' })
    const save = vi.fn().mockResolvedValue(undefined)

    await expect(saveBillingProfile({
      getOrganization: vi.fn().mockResolvedValue({ type: 'school', stripeCustomerId: 'cus_existing' }),
      syncStripeCustomer, saveBillingProfile: save, now: () => 'server-time',
    }, { orgId: 'school-1', profile: validProfile, actorUid: 'uid-1' })).resolves.toEqual({ stripeCustomerId: 'cus_school' })

    expect(syncStripeCustomer).toHaveBeenCalledWith({
      existingCustomerId: 'cus_existing', profile: {
        legalName: '学校法人テスト', contactName: '担当 太郎', email: 'billing@example.test',
        address: { postalCode: '100-0001', prefecture: '東京都', city: '千代田区', line1: '千代田1-1' },
      }, idempotencyKey: 'billing-profile:school-1',
    })
    expect(save).toHaveBeenCalledWith('school-1', {
      billingProfile: {
        legalName: '学校法人テスト', contactName: '担当 太郎', email: 'billing@example.test',
        address: { postalCode: '100-0001', prefecture: '東京都', city: '千代田区', line1: '千代田1-1' },
        updatedAt: 'server-time', updatedByUid: 'uid-1',
      }, stripeCustomerId: 'cus_school',
    })
  })

  it('rejects a non-school before calling Stripe', async () => {
    const syncStripeCustomer = vi.fn()
    await expect(saveBillingProfile({
      getOrganization: vi.fn().mockResolvedValue({ type: 'personal' }), syncStripeCustomer, saveBillingProfile: vi.fn(),
    }, { orgId: 'personal-1', profile: validProfile, actorUid: 'uid-1' })).rejects.toThrow('請求書払いは学校組織のみ利用できます')
    expect(syncStripeCustomer).not.toHaveBeenCalled()
  })
})
