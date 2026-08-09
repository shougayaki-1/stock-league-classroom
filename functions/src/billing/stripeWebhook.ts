import { getFirestore, type Firestore } from 'firebase-admin/firestore'
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
  applyInvoiceLifecycle?: (orgId: string, invoiceId: string, subscriptionStatus: 'ACTIVE' | 'PAST_DUE', billingRecordStatus: 'PAID' | 'OVERDUE') => Promise<void>
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

export const createFirestoreInvoiceLifecycleApplier = (db: Firestore, now: () => string = () => new Date().toISOString()) => async (
  orgId: string,
  invoiceId: string,
  subscriptionStatus: 'ACTIVE' | 'PAST_DUE',
  billingRecordStatus: 'PAID' | 'OVERDUE',
): Promise<void> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  const billingRecordRef = db.doc(`organizations/${orgId}/billingRecords/${invoiceId}`)
  await db.runTransaction(async (transaction) => {
    const existingRecord = await transaction.get(billingRecordRef)
    if (!existingRecord.exists) {
      transaction.update(organizationRef, { subscriptionStatus })
      transaction.set(billingRecordRef, {
        status: billingRecordStatus,
        paymentMethod: 'CARD',
        stripeInvoiceId: invoiceId,
        createdAt: now(),
      })
      return
    }
    if (existingRecord.get('status') === 'OVERDUE' && billingRecordStatus === 'PAID') {
      transaction.update(organizationRef, { subscriptionStatus })
      transaction.update(billingRecordRef, { status: billingRecordStatus })
    }
  })
}

export type StripeWebhookOutcome = { status: 'ok' } | { status: 'retry' }

/**
 * Handles the 4 subscription-lifecycle events this app cares about.
 * checkout.session.completed uses billingRecords.status for idempotency
 * (the record already exists, created by createStripeCheckoutSession);
 * invoice.paid/invoice.payment_failed atomically apply the organization and
 * deterministic invoice-record transition, using Stripe's invoice id as the
 * billingRecords document id and deduplication key.
 *
 * Returns `{status: 'retry'}` only when a Stripe customer id could not be
 * resolved to an organization for the three update events. This can be
 * temporary because Stripe does not guarantee webhook delivery order or the
 * lookup itself may have failed. All other skips are permanent mismatches and
 * return `{status: 'ok'}`.
 */
export const handleStripeWebhookEvent = async (deps: HandleStripeWebhookEventDeps, event: StripeWebhookEvent): Promise<StripeWebhookOutcome> => {
  switch (event.type) {
    case 'checkout.session.completed': {
      if (!event.clientReferenceId || !event.stripeSessionId) return { status: 'ok' }
      const parsed = parseClientReferenceId(event.clientReferenceId)
      if (!parsed) return { status: 'ok' }
      const record = await deps.getBillingRecord(parsed.orgId, parsed.recordId)
      if (record && record.status !== 'PAID') await deps.markBillingRecordPaid(parsed.orgId, parsed.recordId, event.stripeSessionId)
      if (event.stripeCustomerId && deps.linkStripeCustomer) await deps.linkStripeCustomer(parsed.orgId, event.stripeCustomerId)
      return { status: 'ok' }
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      if (!event.invoiceId || !event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.applyInvoiceLifecycle) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      const status = event.type === 'invoice.paid' ? 'ACTIVE' : 'PAST_DUE'
      const recordStatus = event.type === 'invoice.paid' ? 'PAID' : 'OVERDUE'
      await deps.applyInvoiceLifecycle(orgId, event.invoiceId, status, recordStatus)
      return { status: 'ok' }
    }
    case 'customer.subscription.deleted': {
      if (!event.stripeCustomerId || !deps.getOrgIdForStripeCustomer || !deps.setSubscriptionStatus) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      await deps.setSubscriptionStatus(orgId, 'CANCELED')
      return { status: 'ok' }
    }
    default:
      return { status: 'ok' }
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
  const applyInvoiceLifecycle = createFirestoreInvoiceLifecycleApplier(db)
  const outcome = await handleStripeWebhookEvent({
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
    applyInvoiceLifecycle,
  }, extractEvent(stripeEvent))

  if (outcome.status === 'retry') {
    response.status(503).send('retry')
    return
  }
  response.status(200).send('ok')
})
