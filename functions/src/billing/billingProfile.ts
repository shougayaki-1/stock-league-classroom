import { createHash } from 'node:crypto'

export type BillingProfileInput = {
  legalName: string
  contactName: string
  email: string
  address: { postalCode: string; prefecture: string; city: string; line1: string; line2?: string }
}

export type BillingProfile = BillingProfileInput & { updatedAt: unknown; updatedByUid: string }

export interface BillingProfileDeps {
  getOrganization: (orgId: string) => Promise<{ type?: unknown; stripeCustomerId?: unknown } | null>
  syncStripeCustomer: (input: { existingCustomerId: string | null; profile: BillingProfileInput; idempotencyKey: string }) => Promise<{ id: string }>
  saveBillingProfile: (orgId: string, data: { billingProfile: BillingProfile; stripeCustomerId: string }) => Promise<void>
  now?: () => unknown
}

const invalidProfile = (): never => { throw new Error('請求先プロフィールの入力内容が不正です') }

const trimRequired = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return invalidProfile()
  return value.trim()
}

export const validateBillingProfile = (input: unknown): BillingProfileInput => {
  if (!input || typeof input !== 'object') return invalidProfile()
  const value = input as Record<string, unknown>
  if (!value.address || typeof value.address !== 'object') return invalidProfile()
  const address = value.address as Record<string, unknown>
  const email = trimRequired(value.email)
  if (!email.includes('@')) return invalidProfile()
  const line2 = typeof address.line2 === 'string' ? address.line2.trim() : undefined
  return {
    legalName: trimRequired(value.legalName),
    contactName: trimRequired(value.contactName),
    email,
    address: {
      postalCode: trimRequired(address.postalCode),
      prefecture: trimRequired(address.prefecture),
      city: trimRequired(address.city),
      line1: trimRequired(address.line1),
      ...(line2 ? { line2 } : {}),
    },
  }
}

const profileUpdateIdempotencyKey = (orgId: string, profile: BillingProfileInput): string => {
  const fingerprint = createHash('sha256').update(JSON.stringify(profile)).digest('hex')
  return `billing-profile:update:${orgId}:${fingerprint}`
}

export const saveBillingProfile = async (
  deps: BillingProfileDeps,
  input: { orgId: string; profile: BillingProfileInput; actorUid: string },
): Promise<{ stripeCustomerId: string }> => {
  const organization = await deps.getOrganization(input.orgId)
  if (organization?.type !== 'school') throw new Error('請求書払いは学校組織のみ利用できます')
  const profile = validateBillingProfile(input.profile)
  const existingCustomerId = typeof organization.stripeCustomerId === 'string'
    ? organization.stripeCustomerId
    : null
  const customer = await deps.syncStripeCustomer({
    existingCustomerId,
    profile,
    idempotencyKey: existingCustomerId
      ? profileUpdateIdempotencyKey(input.orgId, profile)
      : `billing-profile:${input.orgId}`,
  })
  await deps.saveBillingProfile(input.orgId, {
    billingProfile: { ...profile, updatedAt: deps.now ? deps.now() : new Date().toISOString(), updatedByUid: input.actorUid },
    stripeCustomerId: customer.id,
  })
  return { stripeCustomerId: customer.id }
}
