import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { saveBillingProfile, type BillingProfileInput } from './billingProfile'
import { stripeSecretKey } from './stripeCheckout'

export const saveBillingProfileWithAdminSdk = (
  input: { orgId: string; profile: BillingProfileInput; actorUid: string },
): Promise<{ stripeCustomerId: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return db.runTransaction(async (tx) => {
    const organizationRef = db.doc(`organizations/${input.orgId}`)
    return saveBillingProfile({
      getOrganization: async () => {
        const organization = await tx.get(organizationRef)
        return organization.exists ? organization.data() ?? null : null
      },
      syncStripeCustomer: async ({ existingCustomerId, profile, idempotencyKey }) => {
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
        return existingCustomerId
          ? stripe.customers.update(existingCustomerId, customerData, { idempotencyKey })
          : stripe.customers.create(customerData, { idempotencyKey })
      },
      saveBillingProfile: async (_orgId, data) => {
        tx.update(organizationRef, data)
      },
      now: () => FieldValue.serverTimestamp(),
    }, input)
  })
}
