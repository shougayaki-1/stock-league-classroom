import { getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { defineSecret } from 'firebase-functions/params'
import type { PlanDefinition } from '../organizations/planLimits'

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }

export interface CreateStripeCheckoutSessionDeps {
  getPlanDefinition: (id: string) => Promise<Pick<PlanDefinition, 'stripePriceId'> | null>
  createBillingRecord: (orgId: string, data: { status: 'PENDING'; paymentMethod: 'CARD'; planId: string; createdAt: unknown }) => Promise<string>
  createCheckoutSession: (input: { priceId: string; clientReferenceId: string; successUrl: string; cancelUrl: string; customerId?: string }) => Promise<{ url: string }>
  getExistingStripeCustomerId?: (orgId: string) => Promise<string | null>
  getInvoiceSubscriptionRequest?: (orgId: string) => Promise<{ status?: unknown } | null>
  now?: () => unknown
}

export const createStripeCheckoutSession = async (
  deps: CreateStripeCheckoutSessionDeps,
  input: CreateStripeCheckoutSessionInput,
): Promise<{ url: string }> => {
  const plan = await deps.getPlanDefinition(input.planId)
  if (!plan?.stripePriceId) throw new Error('このプランはまだ決済に対応していません')
  const invoiceRequest = deps.getInvoiceSubscriptionRequest
    ? await deps.getInvoiceSubscriptionRequest(input.orgId)
    : null
  if (invoiceRequest?.status === 'ACTIVE' || invoiceRequest?.status === 'SCHEDULED') {
    throw new Error('請求書払いの契約または切替予約があるためカード申込はできません')
  }
  const recordId = await deps.createBillingRecord(input.orgId, {
    status: 'PENDING', paymentMethod: 'CARD', planId: input.planId, createdAt: deps.now ? deps.now() : new Date().toISOString(),
  })
  const existingCustomerId = deps.getExistingStripeCustomerId
    ? await deps.getExistingStripeCustomerId(input.orgId).catch(() => null)
    : null
  return deps.createCheckoutSession({
    priceId: plan.stripePriceId,
    clientReferenceId: `${input.orgId}:${recordId}`,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerId: existingCustomerId ?? undefined,
  })
}

export const createStripeCheckoutSessionWithAdminSdk = (input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  const organization = db.doc(`organizations/${input.orgId}`).get()
  return createStripeCheckoutSession({
    getPlanDefinition: async (id) => {
      const snap = await db.doc(`planDefinitions/${id}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
    createBillingRecord: async (orgId, data) => (await db.collection(`organizations/${orgId}/billingRecords`).add(data)).id,
    getInvoiceSubscriptionRequest: async () => {
      const snap = await organization
      return snap.exists
        ? (snap.get('invoiceSubscriptionRequest') as { status?: unknown } | undefined) ?? null
        : null
    },
    getExistingStripeCustomerId: async (orgId) => {
      const snap = orgId === input.orgId ? await organization : await db.doc(`organizations/${orgId}`).get()
      return snap.exists ? (snap.get('stripeCustomerId') as string | undefined) ?? null : null
    },
    createCheckoutSession: async ({ priceId, clientReferenceId, successUrl, cancelUrl, customerId }) => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: clientReferenceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(customerId ? { customer: customerId } : {}),
      })
      if (!session.url) throw new Error('Stripe did not return a checkout session url')
      return { url: session.url }
    },
  }, input)
}
