import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { validateBillingProfile } from './billingProfile'
import {
  startInvoiceSubscription,
  type InvoiceSubscriptionRequest,
  type InvoiceSubscriptionReservation,
  type StartInvoiceSubscriptionResult,
} from './invoiceSubscription'
import { stripeSecretKey } from './stripeCheckout'

type StoredInvoiceSubscriptionRequest = InvoiceSubscriptionRequest & { requestedAt?: unknown }

type ReservedRequest =
  | { kind: 'EXISTING'; request: InvoiceSubscriptionRequest }
  | {
    kind: 'CREATE'
    requestId: string
    customerId: string
    priceId: string
    currentCardSubscriptionId?: string
  }

const requestFrom = (value: unknown): InvoiceSubscriptionRequest | null => {
  if (!value || typeof value !== 'object') return null
  const request = value as Record<string, unknown>
  if (
    typeof request.idempotencyKey !== 'string'
    || typeof request.requestedByUid !== 'string'
    || (request.status !== 'CREATING' && request.status !== 'ACTIVE' && request.status !== 'SCHEDULED')
  ) return null
  return {
    idempotencyKey: request.idempotencyKey,
    status: request.status,
    requestedByUid: request.requestedByUid,
    ...(typeof request.stripeSubscriptionId === 'string'
      ? { stripeSubscriptionId: request.stripeSubscriptionId }
      : {}),
    ...(typeof request.stripeScheduleId === 'string' ? { stripeScheduleId: request.stripeScheduleId } : {}),
    ...(typeof request.currentPeriodEndMillis === 'number'
      ? { currentPeriodEndMillis: request.currentPeriodEndMillis }
      : {}),
  }
}

const reserveInvoiceSubscriptionRequest = async (
  db: Firestore,
  stripe: Stripe,
  orgId: string,
  actorUid: string,
): Promise<InvoiceSubscriptionReservation> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  const planRef = db.doc('planDefinitions/SCHOOL')
  const reserved = await db.runTransaction<ReservedRequest>(async (transaction) => {
    const [organization, plan] = await Promise.all([
      transaction.get(organizationRef),
      transaction.get(planRef),
    ])
    const organizationData = organization.exists ? organization.data() : undefined
    const planData = plan.exists ? plan.data() : undefined

    if (organizationData?.type !== 'school') throw new Error('請求書払いは学校組織のみ利用できます')
    validateBillingProfile(organizationData.billingProfile)
    if (typeof organizationData.stripeCustomerId !== 'string' || !organizationData.stripeCustomerId) {
      throw new Error('Stripe Customerが登録されていません')
    }
    if (typeof planData?.stripePriceId !== 'string' || !planData.stripePriceId) {
      throw new Error('このプランはまだ決済に対応していません')
    }

    const existing = requestFrom(organizationData.invoiceSubscriptionRequest)
    if (existing) return { kind: 'EXISTING', request: existing }

    const requestId = db.collection(`organizations/${orgId}/invoiceSubscriptionRequests`).doc().id
    const idempotencyKey = `invoice-subscription:${orgId}:${requestId}`
    transaction.update(organizationRef, {
      invoiceSubscriptionRequest: {
        idempotencyKey,
        status: 'CREATING',
        requestedByUid: actorUid,
        requestedAt: FieldValue.serverTimestamp(),
      },
    })

    const subscriptionState = organizationData.stripeSubscriptionState as Record<string, unknown> | undefined
    return {
      kind: 'CREATE',
      requestId,
      customerId: organizationData.stripeCustomerId,
      priceId: planData.stripePriceId,
      ...(subscriptionState?.status === 'active' && typeof subscriptionState.subscriptionId === 'string'
        ? { currentCardSubscriptionId: subscriptionState.subscriptionId }
        : {}),
    }
  })

  if (reserved.kind === 'EXISTING' || !reserved.currentCardSubscriptionId) return reserved

  const subscription = await stripe.subscriptions.retrieve(reserved.currentCardSubscriptionId)
  if (
    subscription.status !== 'active'
    || subscription.collection_method !== 'charge_automatically'
    || !Number.isFinite(subscription.current_period_end)
  ) {
    throw new Error('有効なカード契約の更新日を確認できません')
  }
  return {
    kind: 'CREATE',
    requestId: reserved.requestId,
    customerId: reserved.customerId,
    priceId: reserved.priceId,
    currentCardSubscription: {
      stripeSubscriptionId: subscription.id,
      currentPeriodEndMillis: subscription.current_period_end * 1_000,
    },
  }
}

const finalizeRequest = async (
  db: Firestore,
  orgId: string,
  requestId: string,
  next: { status: 'ACTIVE'; stripeSubscriptionId: string }
    | { status: 'SCHEDULED'; stripeScheduleId: string; currentPeriodEndMillis: number },
): Promise<void> => {
  const organizationRef = db.doc(`organizations/${orgId}`)
  const expectedKey = `invoice-subscription:${orgId}:${requestId}`
  await db.runTransaction(async (transaction) => {
    const organization = await transaction.get(organizationRef)
    const stored = organization.exists
      ? organization.get('invoiceSubscriptionRequest') as StoredInvoiceSubscriptionRequest | undefined
      : undefined
    if (!stored || stored.idempotencyKey !== expectedKey) {
      throw new Error('請求書払いの申込状態が変更されました')
    }
    if (
      next.status === 'ACTIVE'
      && stored.status === 'ACTIVE'
      && stored.stripeSubscriptionId === next.stripeSubscriptionId
    ) return
    if (
      next.status === 'SCHEDULED'
      && stored.status === 'SCHEDULED'
      && stored.stripeScheduleId === next.stripeScheduleId
      && stored.currentPeriodEndMillis === next.currentPeriodEndMillis
    ) return
    if (stored.status !== 'CREATING') throw new Error('請求書払いの申込状態が変更されました')

    transaction.update(organizationRef, {
      invoiceSubscriptionRequest: { ...stored, ...next },
    })
  })
}

export const startInvoiceSubscriptionWithAdminSdk = (
  input: { orgId: string; actorUid: string },
): Promise<StartInvoiceSubscriptionResult> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  return startInvoiceSubscription({
    reserveRequest: (orgId, actorUid) => reserveInvoiceSubscriptionRequest(db, stripe, orgId, actorUid),
    createSendInvoiceSubscription: async ({ customerId, priceId, collectionMethod, daysUntilDue, idempotencyKey }) => {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        collection_method: collectionMethod,
        days_until_due: daysUntilDue,
        metadata: { orgId: input.orgId, billingMode: 'invoice' },
      }, { idempotencyKey })
      return { stripeSubscriptionId: subscription.id }
    },
    scheduleSendInvoiceAtPeriodEnd: async ({
      stripeSubscriptionId,
      priceId,
      startDateMillis,
      collectionMethod,
      daysUntilDue,
      idempotencyKey,
    }) => {
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: stripeSubscriptionId,
      }, { idempotencyKey: `${idempotencyKey}:schedule-create` })
      const startDateSeconds = startDateMillis / 1_000
      const currentPhase = schedule.phases.find((phase) => phase.end_date === startDateSeconds)
      if (!currentPhase) throw new Error('有効なカード契約の現在期間を確認できません')
      const updated = await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
          {
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date,
            items: currentPhase.items.map((item) => ({
              price: typeof item.price === 'string' ? item.price : item.price.id,
              ...(typeof item.quantity === 'number' ? { quantity: item.quantity } : {}),
            })),
            ...(currentPhase.collection_method ? { collection_method: currentPhase.collection_method } : {}),
          },
          {
            start_date: startDateSeconds,
            items: [{ price: priceId, quantity: 1 }],
            collection_method: collectionMethod,
            invoice_settings: { days_until_due: daysUntilDue },
            metadata: { orgId: input.orgId, billingMode: 'invoice' },
          },
        ],
        metadata: {
          orgId: input.orgId,
          billingMode: 'invoice',
          previousSubscriptionId: stripeSubscriptionId,
        },
      }, { idempotencyKey: `${idempotencyKey}:schedule-update` })
      return { stripeScheduleId: updated.id }
    },
    finalizeActive: (orgId, requestId, stripeSubscriptionId) => finalizeRequest(
      db,
      orgId,
      requestId,
      { status: 'ACTIVE', stripeSubscriptionId },
    ),
    finalizeScheduled: (orgId, requestId, stripeScheduleId, currentPeriodEndMillis) => finalizeRequest(
      db,
      orgId,
      requestId,
      { status: 'SCHEDULED', stripeScheduleId, currentPeriodEndMillis },
    ),
  }, input)
}
