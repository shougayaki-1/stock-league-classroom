import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { validateBillingProfile, type BillingProfileInput } from './billingProfile'
import { stripeSecretKey } from './stripeCheckout'

export const saveBillingProfileWithAdminSdk = (
  input: { orgId: string; profile: BillingProfileInput; actorUid: string },
): Promise<{ stripeCustomerId: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return db.runTransaction(async (tx) => {
    const organizationRef = db.doc(`organizations/${input.orgId}`)
    const organization = await tx.get(organizationRef)
    const organizationData = organization.exists ? organization.data() : null
    if (organizationData?.type !== 'school') throw new Error('請求書払いは学校組織のみ利用できます')
    const profile = validateBillingProfile(input.profile)
    const existingCustomerId = typeof organizationData.stripeCustomerId === 'string' ? organizationData.stripeCustomerId : null
    const customerData = {
        name: profile.legalName,
        email: profile.email,
        address: {
          postal_code: profile.address.postalCode,
          state: profile.address.prefecture,
          city: profile.address.city,
          line1: profile.address.line1,
          ...(profile.address.line2 ? { line2: profile.address.line2 } : {}),
          country: 'JP',
        },
      }
    const customer = existingCustomerId
      ? await stripe.customers.update(existingCustomerId, customerData, { idempotencyKey: `billing-profile:${input.orgId}` })
      : await stripe.customers.create(customerData, { idempotencyKey: `billing-profile:${input.orgId}` })
    tx.update(organizationRef, {
      billingProfile: { ...profile, updatedAt: FieldValue.serverTimestamp(), updatedByUid: input.actorUid },
      stripeCustomerId: customer.id,
    })
    return { stripeCustomerId: customer.id }
  })
}
