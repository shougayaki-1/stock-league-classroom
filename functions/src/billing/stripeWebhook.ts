import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/v2'
import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Stripe from 'stripe'
import type { ParentContractState } from '../organizations/parentContract'
import { parentContractStateFor, shouldApplySubscriptionState, type StripeSubscriptionState } from './subscriptionState'
import { stripeSecretKey } from './stripeCheckout'

export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET')

export type StripeWebhookEvent =
  | { type: 'checkout.session.completed'; clientReferenceId?: string; stripeSessionId?: string; stripeCustomerId?: string }
  | { type: 'invoice.paid' | 'invoice.payment_failed'; invoiceId?: string; stripeCustomerId?: string }
  | { type: 'customer.subscription.deleted'; stripeCustomerId?: string; stripeSubscriptionId?: string; eventCreatedAtMillis?: number }
  | { type: 'customer.subscription.updated'; stripeCustomerId?: string; stripeSubscriptionId?: string; currentPriceId?: string; stripeScheduleId?: string; status?: string; eventCreatedAtMillis?: number }
  | { type: string; clientReferenceId?: string; stripeSessionId?: string; stripeCustomerId?: string; invoiceId?: string; stripeSubscriptionId?: string; currentPriceId?: string; stripeScheduleId?: string; status?: string; eventCreatedAtMillis?: number }

export interface ScheduledPlanChange {
  planId: string
  effectiveAtMillis: number
}

export interface PendingPlanChangeSummary {
  planId: string
  stripeScheduleId?: string
}

export interface SubscriptionPlanChangeSyncInput {
  kind: 'SCHEDULE' | 'APPLY'
  planId: string
  effectiveAtMillis?: number
  stripeSubscriptionId: string
  stripeScheduleId: string
}

export interface HandleStripeWebhookEventDeps {
  getBillingRecord: (orgId: string, recordId: string) => Promise<{ status: string } | null>
  markBillingRecordPaid: (orgId: string, recordId: string, stripeSessionId: string) => Promise<void>
  linkStripeCustomer?: (orgId: string, stripeCustomerId: string) => Promise<void>
  getOrgIdForStripeCustomer?: (stripeCustomerId: string) => Promise<string | null>
  setSubscriptionStatus?: (orgId: string, status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED') => Promise<void>
  applyInvoiceLifecycle?: (orgId: string, invoiceId: string, subscriptionStatus: 'ACTIVE' | 'PAST_DUE', billingRecordStatus: 'PAID' | 'OVERDUE') => Promise<void>
  getPlanIdForStripePrice?: (stripePriceId: string) => Promise<string | null>
  getScheduledPlanChange?: (stripeScheduleId: string) => Promise<ScheduledPlanChange | null>
  getPendingPlanChange?: (orgId: string) => Promise<PendingPlanChangeSummary | null>
  syncSubscriptionPlanChange?: (orgId: string, input: SubscriptionPlanChangeSyncInput) => Promise<void>
  syncStripeSubscriptionState?: (
    orgId: string,
    state: StripeSubscriptionState,
    parentContractState: ParentContractState | undefined,
  ) => Promise<void>
  clearPendingPlanChange?: (orgId: string) => Promise<void>
  logSubscriptionPlanChangeIssue?: (details: Record<string, unknown>) => void
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

const GRACE_PERIOD_MILLIS = 30 * 24 * 60 * 60 * 1_000

export const createFirestoreSubscriptionPlanChangeSynchronizer = (
  db: Firestore,
  nowMillis: () => number = () => Date.now(),
) => async (orgId: string, input: SubscriptionPlanChangeSyncInput): Promise<void> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  await db.runTransaction(async (transaction) => {
    const organization = await transaction.get(organizationRef)
    if (!organization.exists) throw new Error('Organization not found')

    if (input.kind === 'SCHEDULE') {
      if (input.effectiveAtMillis == null || !Number.isFinite(input.effectiveAtMillis)) {
        throw new Error('Invalid scheduled plan change')
      }
      transaction.update(organizationRef, {
        pendingPlanChange: {
          planId: input.planId,
          stripeSubscriptionId: input.stripeSubscriptionId,
          stripeScheduleId: input.stripeScheduleId,
          effectiveAt: Timestamp.fromMillis(input.effectiveAtMillis),
        },
      })
      return
    }

    const pending = organization.get('pendingPlanChange') as { planId?: unknown; stripeScheduleId?: unknown } | undefined
    if (pending?.planId !== input.planId || pending.stripeScheduleId !== input.stripeScheduleId) return

    const update: Record<string, unknown> = {
      planId: input.planId,
      pendingPlanChange: FieldValue.delete(),
    }
    const grace = organization.get('downgradeGrace') as { planId?: unknown; startedAt?: unknown; endsAt?: unknown } | undefined
    if (grace?.planId !== input.planId || !grace.startedAt || !grace.endsAt) {
      const startedAtMillis = nowMillis()
      update.downgradeGrace = {
        planId: input.planId,
        startedAt: Timestamp.fromMillis(startedAtMillis),
        endsAt: Timestamp.fromMillis(startedAtMillis + GRACE_PERIOD_MILLIS),
      }
    }
    transaction.update(organizationRef, update)
  })
}

export const createFirestorePendingPlanChangeReader = (db: Firestore) => async (orgId: string): Promise<PendingPlanChangeSummary | null> => {
  const snap = await db.doc(`organizations/${orgId}`).get()
  if (!snap.exists) return null
  const pending = snap.get('pendingPlanChange') as { planId?: unknown; stripeScheduleId?: unknown } | undefined
  if (!pending || typeof pending.planId !== 'string') return null
  return {
    planId: pending.planId,
    ...(typeof pending.stripeScheduleId === 'string' ? { stripeScheduleId: pending.stripeScheduleId } : {}),
  }
}

export const createFirestorePendingPlanChangeClearer = (db: Firestore) => async (orgId: string): Promise<void> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  await db.runTransaction(async (transaction) => {
    const organization = await transaction.get(organizationRef)
    if (!organization.exists || !organization.get('pendingPlanChange')) return
    transaction.update(organizationRef, { pendingPlanChange: FieldValue.delete() })
  })
}

export const createFirestoreStripeSubscriptionStateSynchronizer = (db: Firestore) => async (
  orgId: string,
  incoming: StripeSubscriptionState,
  parentContractState: ParentContractState | undefined,
): Promise<void> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  await db.runTransaction(async (transaction) => {
    const organization = await transaction.get(organizationRef)
    if (!organization.exists) return

    const existing = organization.get('stripeSubscriptionState') as StripeSubscriptionState | undefined
    if (!shouldApplySubscriptionState(existing, incoming)) return

    const parentState = parentContractStateFor(organization.get('type') as string | undefined, incoming.status)
      ?? (organization.get('type') === 'parentOrg' ? parentContractState : undefined)

    transaction.update(organizationRef, {
      stripeSubscriptionState: incoming,
      ...(incoming.status === 'canceled' ? { subscriptionStatus: 'CANCELED' } : {}),
      ...(incoming.status === 'active' ? { subscriptionStatus: 'ACTIVE' } : {}),
      ...(parentState === undefined ? {} : {
        parentContractState: parentState,
        parentContractSubscriptionId: incoming.subscriptionId,
        parentContractEventCreatedAtMillis: incoming.eventCreatedAtMillis,
        ...(parentState === 'ENDED'
          ? { parentContractEndedAt: FieldValue.serverTimestamp() }
          : { parentContractEndedAt: FieldValue.delete() }),
      }),
    })
  })
}

export type StripeWebhookOutcome = { status: 'ok' } | { status: 'retry' }

export const sendStripeWebhookOutcome = (
  response: { status: (code: number) => { send: (body: string) => unknown } },
  outcome: StripeWebhookOutcome,
): void => {
  if (outcome.status === 'retry') {
    response.status(503).send('retry')
    return
  }
  response.status(200).send('ok')
}

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
      if (!event.stripeCustomerId || !deps.getOrgIdForStripeCustomer) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      if (event.stripeSubscriptionId && typeof event.eventCreatedAtMillis === 'number' && deps.syncStripeSubscriptionState) {
        await deps.syncStripeSubscriptionState(orgId, {
          subscriptionId: event.stripeSubscriptionId,
          status: 'canceled',
          eventCreatedAtMillis: event.eventCreatedAtMillis,
        }, 'ENDED')
      }
      return { status: 'ok' }
    }
    case 'customer.subscription.updated': {
      if (!event.stripeCustomerId || !deps.getOrgIdForStripeCustomer) return { status: 'ok' }
      const orgId = await resolveOrgIdForStripeCustomer(deps, event.stripeCustomerId)
      if (!orgId) return { status: 'retry' }
      if (event.stripeSubscriptionId && typeof event.status === 'string' && typeof event.eventCreatedAtMillis === 'number' && deps.syncStripeSubscriptionState) {
        await deps.syncStripeSubscriptionState(orgId, {
          subscriptionId: event.stripeSubscriptionId,
          status: event.status,
          eventCreatedAtMillis: event.eventCreatedAtMillis,
        }, parentContractStateFor('parentOrg', event.status))
      }
      if (!event.currentPriceId) return { status: 'ok' }
      if (!deps.getPlanIdForStripePrice) return { status: 'ok' }

      const currentPlanId = await deps.getPlanIdForStripePrice(event.currentPriceId)
      if (!currentPlanId) {
        deps.logSubscriptionPlanChangeIssue?.({ reason: 'unknown-current-price', orgId, stripePriceId: event.currentPriceId })
        return { status: 'ok' }
      }

      if (!event.stripeSubscriptionId || !deps.syncSubscriptionPlanChange) return { status: 'ok' }

      const pending = deps.getPendingPlanChange ? await deps.getPendingPlanChange(orgId) : null
      if (!event.stripeScheduleId || !deps.getScheduledPlanChange) {
        if (pending?.planId === currentPlanId && pending.stripeScheduleId) {
          await deps.syncSubscriptionPlanChange(orgId, {
            kind: 'APPLY', planId: currentPlanId,
            stripeSubscriptionId: event.stripeSubscriptionId, stripeScheduleId: pending.stripeScheduleId,
          })
          return { status: 'ok' }
        }
        if (pending && deps.clearPendingPlanChange) await deps.clearPendingPlanChange(orgId)
        return { status: 'ok' }
      }

      const scheduled = await deps.getScheduledPlanChange(event.stripeScheduleId)
      if (!scheduled) {
        deps.logSubscriptionPlanChangeIssue?.({ reason: 'invalid-or-ambiguous-schedule', orgId, stripeScheduleId: event.stripeScheduleId })
        return { status: 'ok' }
      }

      if (currentPlanId === scheduled.planId) {
        if (pending?.planId === currentPlanId && pending.stripeScheduleId === event.stripeScheduleId) {
          await deps.syncSubscriptionPlanChange(orgId, {
            kind: 'APPLY', planId: currentPlanId,
            stripeSubscriptionId: event.stripeSubscriptionId, stripeScheduleId: event.stripeScheduleId,
          })
        } else {
          deps.logSubscriptionPlanChangeIssue?.({ reason: 'current-price-without-matching-pending-plan', orgId, currentPlanId })
        }
        return { status: 'ok' }
      }

      await deps.syncSubscriptionPlanChange(orgId, {
        kind: 'SCHEDULE', planId: scheduled.planId, effectiveAtMillis: scheduled.effectiveAtMillis,
        stripeSubscriptionId: event.stripeSubscriptionId, stripeScheduleId: event.stripeScheduleId,
      })
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
        stripeSubscriptionId: subscription.id,
        eventCreatedAtMillis: stripeEvent.created * 1_000,
      }
    }
    case 'customer.subscription.updated': {
      const subscription = stripeEvent.data.object as Stripe.Subscription
      const itemPriceIds = subscription.items.data.map((item) => typeof item.price === 'string' ? item.price : item.price.id)
      const schedule = subscription.schedule
      return {
        type: 'customer.subscription.updated',
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        stripeSubscriptionId: subscription.id,
        currentPriceId: itemPriceIds.length === 1 ? itemPriceIds[0] : undefined,
        stripeScheduleId: typeof schedule === 'string' ? schedule : schedule?.id,
        status: subscription.status,
        eventCreatedAtMillis: stripeEvent.created * 1_000,
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
  const stripe = new Stripe(stripeSecretKey.value())
  const applyInvoiceLifecycle = createFirestoreInvoiceLifecycleApplier(db)
  const syncStripeSubscriptionState = createFirestoreStripeSubscriptionStateSynchronizer(db)
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
    applyInvoiceLifecycle,
    getPlanIdForStripePrice: async (stripePriceId) => {
      const snap = await db.collection('planDefinitions').where('stripePriceId', '==', stripePriceId).get()
      if (snap.size !== 1) return null
      return snap.docs[0].id
    },
    getScheduledPlanChange: async (stripeScheduleId) => {
      type SchedulePhase = { start_date: number; items: Array<{ price: string | { id: string } }> }
      type ScheduleLike = { phases: SchedulePhase[]; current_phase?: { end_date: number } | null }
      const schedule = await stripe.subscriptionSchedules.retrieve(stripeScheduleId) as unknown as ScheduleLike
      const currentPhaseEnd = schedule.current_phase?.end_date
      const nextPhase = [...schedule.phases]
        .filter((phase) => currentPhaseEnd != null ? phase.start_date >= currentPhaseEnd : phase.start_date * 1_000 > Date.now())
        .sort((left, right) => left.start_date - right.start_date)[0]
      if (!nextPhase) return null
      const priceIds = [...new Set(nextPhase.items.map((item) => typeof item.price === 'string' ? item.price : item.price.id))]
      if (priceIds.length !== 1) return null
      const planSnap = await db.collection('planDefinitions').where('stripePriceId', '==', priceIds[0]).get()
      if (planSnap.size !== 1) return null
      return { planId: planSnap.docs[0].id, effectiveAtMillis: nextPhase.start_date * 1_000 }
    },
    getPendingPlanChange: createFirestorePendingPlanChangeReader(db),
    syncSubscriptionPlanChange: createFirestoreSubscriptionPlanChangeSynchronizer(db),
    syncStripeSubscriptionState,
    clearPendingPlanChange: createFirestorePendingPlanChangeClearer(db),
    logSubscriptionPlanChangeIssue: (details) => { logger.warn('Stripe subscription plan change was not synchronized', details) },
  }, extractEvent(stripeEvent))

  sendStripeWebhookOutcome(response, outcome)
})
