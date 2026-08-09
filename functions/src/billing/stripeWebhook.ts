import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'
import { stripeSecretKey } from './stripeCheckout'

export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')

export type StripeWebhookEvent =
  | { type: 'checkout.session.completed'; clientReferenceId?: string; stripeSessionId?: string; stripeCustomerId?: string }
  | { type: 'invoice.paid' | 'invoice.payment_failed'; invoiceId?: string; stripeCustomerId?: string }
  | { type: 'customer.subscription.deleted'; stripeCustomerId?: string }
  | { type: string; clientReferenceId?: string; stripeSessionId?: string; stripeCustomerId?: string; invoiceId?: string }

export interface HandleStripeWebhookEventDeps {
  getBillingRecord: (orgId: string, recordId: string) => Promise<{ status: string } | null>
  markBillingRecordPaid: (orgId: string, recordId: string, stripeSessionId: string) => Promise<void>
  linkStripeCustomer?: (orgId: string, stripeCustomerId: string) => Promise<void>
  getOrgIdForStripeCustomer?: (stripeCustomerId: string) => Promise<string | null>
  setSubscriptionStatus?: (orgId: string, status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED') => Promise<void>
  hasBillingRecordForInvoice?: (orgId: string, invoiceId: string) => Promise<boolean>
  createBillingRecordForInvoice?: (orgId: string, invoiceId: string, status: 'PAID' | 'OVERDUE') => Promise<void>
  logUnresolvedStripeCustomer?: (stripeCustomerId: string) => void
  logStripeCustomerLookupError?: (stripeCustomerId: string, error: unknown) => void
}

const parseClientReferenceId = (value: string): { orgId: string; recordId: string } | null => {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex < 1 || separatorIndex === value.length - 1) return null
  return { orgId: value.slice(0, separatorIndex), recordId: value.slice(separatorIndex + 1) }
}

const resolveOrgIdForStripeCustomer = async (deps: HandleStripeWebhookEventDeps, stripeCustomerId: string): Promise<string | null> => {
  if (!deps.getOrgIdForStripeCustomer) return null
  try {
    const orgId = await deps.getOrgIdForStripeCustomer(stripeCustomerId)
    if (!orgId) deps.logUnresolvedStripeCustomer?.(stripeCustomerId)
    return orgId
  } catch (error) {
    deps.logStripeCustomerLookupError?.(stripeCustomerId, error)
    return null
  }
}

/**
 * Handles the 4 subscription-lifecycle events this app cares about.
 * checkout.session.completed uses billingRecords.status for idempotency
 * (the record already exists, created by createStripeCheckoutSession);
 * invoice.paid/invoice.payment_failed use Stripe's own invoice id instead,
 * since each billing cycle creates a brand-new billingRecords entry rather
 * than reusing one (see this task's design note in the plan).
 */
export const handleStripeWebhookEvent = async (deps: HandleStripeWebhookEventDeps, event: StripeWebhookEvent): Promise<void> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!event.clientReferenceId || !event.stripeSessionId) return
      const parsed = parseClientReferenceId(event.clientReferenceId)
      if (!parsed) return
      const record = await deps.getBillingRecord(parsed.orgId, parsed.recordId)
      if (record && record.status !== 'PAID') await deps.markBillingRecordPaid(parsed.orgId, parsed.recordId, event.stripeSessionId)
      if (event.stripeCustomerId && deps.linkStripeCustomer) await deps.linkStripeCustomer(parsed.orgId, event.stripeCustomerId)
      return
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      if (!event.invoiceId || !event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.hasBillingRecordForInvoice || !deps.setSubscriptionStatus || !deps.createBillingRecordForInvoice) return
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return
      if (await deps.hasBillingRecordForInvoice(orgId, event.invoiceId)) return
      const status = event.type === 'invoice.paid' ? 'ACTIVE' : 'PAST_DUE'
      const recordStatus = event.type === 'invoice.paid' ? 'PAID' : 'OVERDUE'
      await deps.setSubscriptionStatus(orgId, status)
      await deps.createBillingRecordForInvoice(orgId, event.invoiceId, recordStatus)
      return
    }
    case 'customer.subscription.deleted': {
      if (!event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.setSubscriptionStatus) return
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return
      await deps.setSubscriptionStatus(orgId, 'CANCELED')
      return
    }
    default:
      return
  }
}

const extractEvent = (stripeEvent: Stripe.Event): StripeWebhookEvent => {
  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as Stripe.Checkout.Session
      return {
        type: 'checkout.session.completed',
        clientReferenceId: session.client_reference_id ?? undefined,
        stripeSessionId: session.id,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = stripeEvent.data.object as Stripe.Invoice
      return {
        type: stripeEvent.type,
        invoiceId: invoice.id,
        stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
      }
    }
    case 'customer.subscription.deleted': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      return {
        type: 'customer.subscription.deleted',
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
      }
    }
    default:
      return { type: stripeEvent.type }
  }
}

/** Production wiring: verifies the Stripe signature, then dispatches to handleStripeWebhookEvent. */
export const stripeWebhookCallable = onRequest({ region: 'asia-northeast1', secrets: [stripeWebhookSecret, stripeSecretKey] }, async (request, response) => {
  const signature = request.headers['stripe-signature']
  if (typeof signature !== 'string') { response.status(400).send('Missing signature'); return }

  let stripeEvent: Stripe.Event
  try {
    stripeEvent = new Stripe(stripeSecretKey.value()).webhooks.constructEvent(request.rawBody, signature, stripeWebhookSecret.value())
  } catch {
    response.status(400).send('Invalid signature')
    return
  }

  const db = getFirestore()
  await handleStripeWebhookEvent({
    getBillingRecord: async (orgId, recordId) => {
      const snap = await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).get()
      return snap.exists ? (snap.data() as { status: string }) : null
    },
    markBillingRecordPaid: async (orgId, recordId, stripeSessionId) => {
      await db.doc(`organizations/${orgId}/billingRecords/${recordId}`).update({ status: 'PAID', paidAt: new Date().toISOString(), stripeSessionId })
    },
    linkStripeCustomer: async (orgId, stripeCustomerId) => {
      await db.doc(`organizations/${orgId}`).update({ stripeCustomerId })
      await db.doc(`stripeCustomers/${stripeCustomerId}`).set({ orgId })
    },
    getOrgIdForStripeCustomer: async (stripeCustomerId) => {
      const snap = await db.doc(`stripeCustomers/${stripeCustomerId}`).get()
      return snap.exists ? (snap.get('orgId') as string) : null
    },
    logUnresolvedStripeCustomer: (stripeCustomerId) => {
      logger.warn('Stripe customer could not be resolved to an organization', { stripeCustomerId })
    },
    logStripeCustomerLookupError: (stripeCustomerId, error) => {
      logger.error('Stripe customer reverse lookup failed', { stripeCustomerId, error })
    },
    setSubscriptionStatus: async (orgId, status) => { await db.doc(`organizations/${orgId}`).update({ subscriptionStatus: status }) },
    hasBillingRecordForInvoice: async (orgId, invoiceId) => {
      const snap = await db.collection(`organizations/${orgId}/billingRecords`).where('stripeInvoiceId', '==', invoiceId).limit(1).get()
      return !snap.empty
    },
    createBillingRecordForInvoice: async (orgId, invoiceId, status) => {
      await db.collection(`organizations/${orgId}/billingRecords`).add({
        status, paymentMethod: 'CARD', stripeInvoiceId: invoiceId, createdAt: new Date().toISOString(),
      })
    },
  }, extractEvent(stripeEvent))

  response.status(200).send('ok')
})
