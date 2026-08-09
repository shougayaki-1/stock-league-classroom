import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { defineSecret } from 'firebase-functions/params'
import type { PlanDefinition } from '../organizations/planLimits'
export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')
export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }
export const createStripeCheckoutSession = async (deps: { getPlanDefinition: (id: string) => Promise<Pick<PlanDefinition, 'stripePriceId'> | null>; createBillingRecord: (orgId: string, data: { status: 'PENDING'; paymentMethod: 'CARD'; planId: string; createdAt: unknown }) => Promise<string>; createCheckoutSession: (input: { priceId: string; clientReferenceId: string; successUrl: string; cancelUrl: string }) => Promise<{ url: string }>; now?: () => unknown }, input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => {
  const plan = await deps.getPlanDefinition(input.planId); if (!plan?.stripePriceId) throw new Error('このプランはまだ決済に対応していません')
  const recordId = await deps.createBillingRecord(input.orgId, { status: 'PENDING', paymentMethod: 'CARD', planId: input.planId, createdAt: deps.now ? deps.now() : new Date().toISOString() })
  return deps.createCheckoutSession({ priceId: plan.stripePriceId, clientReferenceId: `${input.orgId}:${recordId}`, successUrl: input.successUrl, cancelUrl: input.cancelUrl })
}
export const createStripeCheckoutSessionWithAdminSdk = (input: CreateStripeCheckoutSessionInput) => {
  const db = getFirestore(); const stripe = new Stripe(stripeSecretKey.value())
  return createStripeCheckoutSession({ getPlanDefinition: async (id) => { const snap = await db.doc(`planDefinitions/${id}`).get(); return snap.exists ? snap.data() as PlanDefinition : null }, createBillingRecord: async (orgId, data) => (await db.collection(`organizations/${orgId}/billingRecords`).add(data)).id, createCheckoutSession: async ({ priceId, clientReferenceId, successUrl, cancelUrl }) => { const session = await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], client_reference_id: clientReferenceId, success_url: successUrl, cancel_url: cancelUrl }); if (!session.url) throw new Error('Stripe did not return a checkout session url'); return { url: session.url } } }, input)
}
