import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { stripeSecretKey } from './stripeCheckout'

export interface CreateStripeCustomerPortalSessionDeps {
  getStripeCustomerId: (orgId: string) => Promise<string | null>
  createPortalSession: (input: { customerId: string; returnUrl: string }) => Promise<{ url: string }>
}

export interface CreateStripeCustomerPortalSessionInput {
  orgId: string
  returnUrl: string
}

export const createStripeCustomerPortalSession = async (
  deps: CreateStripeCustomerPortalSessionDeps,
  input: CreateStripeCustomerPortalSessionInput,
): Promise<{ url: string }> => {
  const customerId = await deps.getStripeCustomerId(input.orgId)
  if (!customerId) throw new Error('まだ決済履歴がありません')

  return deps.createPortalSession({ customerId, returnUrl: input.returnUrl })
}

/** Production wiring: Firestore Admin SDK + Stripe SDK. */
export const createStripeCustomerPortalSessionWithAdminSdk = (
  input: CreateStripeCustomerPortalSessionInput,
): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())

  return createStripeCustomerPortalSession({
    getStripeCustomerId: async (orgId) => {
      const snap = await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? (snap.get('stripeCustomerId') as string | undefined) ?? null : null
    },
    createPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      })
      return { url: session.url }
    },
  }, input)
}
