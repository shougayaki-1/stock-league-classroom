import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { defineSecret } from 'firebase-functions/params'
import type { PlanDefinition } from '../organizations/planLimits'

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY')

export interface CreateStripeCheckoutSessionInput { orgId: string; planId: string; successUrl: string; cancelUrl: string }

export interface CreateStripeCheckoutSessionDeps {
  getPlanDefinition: (id: string) => Promise<Pick<PlanDefinition, 'stripePriceId'> | null>
  createBillingRecord?: (orgId: string, data: { status: 'PENDING'; paymentMethod: 'CARD'; planId: string; createdAt: unknown }) => Promise<string>
  reserveCardCheckout?: (input: {
    orgId: string
    planId: string
    priceId: string
    successUrl: string
    cancelUrl: string
  }) => Promise<{
    recordId: string
    priceId: string
    customerId?: string
    expiresAtMillis: number
    idempotencyKey: string
  }>
  finalizeCardCheckout?: (input: {
    orgId: string
    recordId: string
    stripeSessionId: string
    expiresAtMillis: number
  }) => Promise<void>
  createCheckoutSession: (input: {
    priceId: string
    clientReferenceId: string
    successUrl: string
    cancelUrl: string
    customerId?: string
    expiresAtMillis?: number
    idempotencyKey?: string
  }) => Promise<{ url: string; stripeSessionId?: string; expiresAtMillis?: number }>
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
  if (
    invoiceRequest?.status === 'CREATING'
    || invoiceRequest?.status === 'ACTIVE'
    || invoiceRequest?.status === 'SCHEDULED'
  ) {
    throw new Error('請求書払いの契約または切替予約があるためカード申込はできません')
  }
  const reserved = deps.reserveCardCheckout
    ? await deps.reserveCardCheckout({
      orgId: input.orgId,
      planId: input.planId,
      priceId: plan.stripePriceId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    })
    : null
  if (!reserved && !deps.createBillingRecord) throw new Error('カード申込を予約できません')
  const recordId = reserved?.recordId ?? await deps.createBillingRecord!(input.orgId, {
    status: 'PENDING', paymentMethod: 'CARD', planId: input.planId, createdAt: deps.now ? deps.now() : new Date().toISOString(),
  })
  const existingCustomerId = reserved?.customerId ?? (deps.getExistingStripeCustomerId
    ? await deps.getExistingStripeCustomerId(input.orgId).catch(() => null)
    : null)
  const session = await deps.createCheckoutSession({
    priceId: reserved?.priceId ?? plan.stripePriceId,
    clientReferenceId: `${input.orgId}:${recordId}`,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    customerId: existingCustomerId ?? undefined,
    ...(reserved ? {
      expiresAtMillis: reserved.expiresAtMillis,
      idempotencyKey: reserved.idempotencyKey,
    } : {}),
  })
  if (reserved && deps.finalizeCardCheckout) {
    if (!session.stripeSessionId) throw new Error('Stripe did not return a checkout session id')
    await deps.finalizeCardCheckout({
      orgId: input.orgId,
      recordId,
      stripeSessionId: session.stripeSessionId,
      expiresAtMillis: session.expiresAtMillis ?? reserved.expiresAtMillis,
    })
  }
  return { url: session.url }
}

export const createStripeCheckoutSessionWithAdminSdk = (input: CreateStripeCheckoutSessionInput): Promise<{ url: string }> => {
  const db = getFirestore()
  const stripe = new Stripe(stripeSecretKey.value())
  const organizationRef = db.doc(`organizations/${input.orgId}`)
  return createStripeCheckoutSession({
    getPlanDefinition: async (id) => {
      const snap = await db.doc(`planDefinitions/${id}`).get()
      return snap.exists ? (snap.data() as PlanDefinition) : null
    },
    reserveCardCheckout: async ({ orgId, planId, priceId, successUrl, cancelUrl }) => {
      const recordRef = db.collection(`organizations/${orgId}/billingRecords`).doc()
      const requestFingerprint = [planId, priceId, successUrl, cancelUrl].join('\n')
      const expiresAtMillis = Date.now() + 30 * 60 * 1_000
      return db.runTransaction(async (transaction) => {
        const organization = await transaction.get(organizationRef)
        if (!organization.exists) throw new Error('Organization not found')
        const invoiceRequest = organization.get('invoiceSubscriptionRequest') as { status?: unknown } | undefined
        if (
          invoiceRequest?.status === 'CREATING'
          || invoiceRequest?.status === 'ACTIVE'
          || invoiceRequest?.status === 'SCHEDULED'
        ) throw new Error('請求書払いの契約または切替予約があるためカード申込はできません')
        const existingReservation = organization.get('cardCheckoutReservation') as Record<string, unknown> | undefined
        if (
          existingReservation
          && typeof existingReservation.expiresAtMillis === 'number'
          && existingReservation.expiresAtMillis > Date.now()
        ) {
          if (
            existingReservation.status === 'CREATING'
            && existingReservation.requestFingerprint === requestFingerprint
            && typeof existingReservation.billingRecordId === 'string'
            && typeof existingReservation.idempotencyKey === 'string'
          ) {
            return {
              recordId: existingReservation.billingRecordId,
              priceId,
              ...(typeof organization.get('stripeCustomerId') === 'string'
                ? { customerId: organization.get('stripeCustomerId') as string }
                : {}),
              expiresAtMillis: existingReservation.expiresAtMillis,
              idempotencyKey: existingReservation.idempotencyKey,
            }
          }
          throw new Error('カード申込を処理中です')
        }
        const idempotencyKey = `stripe-checkout:${orgId}:${recordRef.id}`
        transaction.set(recordRef, {
          status: 'PENDING',
          paymentMethod: 'CARD',
          planId,
          createdAt: FieldValue.serverTimestamp(),
        })
        transaction.update(organizationRef, {
          cardCheckoutReservation: {
            status: 'CREATING',
            billingRecordId: recordRef.id,
            idempotencyKey,
            requestFingerprint,
            expiresAtMillis,
            requestedAt: FieldValue.serverTimestamp(),
          },
        })
        return {
          recordId: recordRef.id,
          priceId,
          ...(typeof organization.get('stripeCustomerId') === 'string'
            ? { customerId: organization.get('stripeCustomerId') as string }
            : {}),
          expiresAtMillis,
          idempotencyKey,
        }
      })
    },
    finalizeCardCheckout: async ({ recordId, stripeSessionId, expiresAtMillis }) => {
      await db.runTransaction(async (transaction) => {
        const organization = await transaction.get(organizationRef)
        const reservation = organization.get('cardCheckoutReservation') as Record<string, unknown> | undefined
        if (reservation?.billingRecordId !== recordId) throw new Error('カード申込の予約状態が変更されました')
        if (reservation.status === 'PENDING' && reservation.stripeSessionId === stripeSessionId) return
        if (reservation.status !== 'CREATING') throw new Error('カード申込の予約状態が変更されました')
        transaction.update(organizationRef, {
          cardCheckoutReservation: {
            ...reservation,
            status: 'PENDING',
            stripeSessionId,
            expiresAtMillis,
          },
        })
      })
    },
    createCheckoutSession: async ({
      priceId,
      clientReferenceId,
      successUrl,
      cancelUrl,
      customerId,
      expiresAtMillis,
      idempotencyKey,
    }) => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: clientReferenceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(customerId ? { customer: customerId } : {}),
        ...(expiresAtMillis ? { expires_at: Math.floor(expiresAtMillis / 1_000) } : {}),
      }, idempotencyKey ? { idempotencyKey } : undefined)
      if (!session.url) throw new Error('Stripe did not return a checkout session url')
      return {
        url: session.url,
        stripeSessionId: session.id,
        ...(typeof session.expires_at === 'number' ? { expiresAtMillis: session.expires_at * 1_000 } : {}),
      }
    },
  }, input)
}
