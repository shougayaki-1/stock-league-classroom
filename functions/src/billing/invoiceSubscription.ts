import type { BillingProfileInput } from './billingProfile'

export type InvoiceSubscriptionRequest = {
  idempotencyKey: string
  status: 'CREATING' | 'ACTIVE' | 'SCHEDULED'
  requestedByUid: string
  stripeSubscriptionId?: string
  stripeScheduleId?: string
  currentPeriodEndMillis?: number
}

export type StartInvoiceSubscriptionResult =
  | { status: 'ACTIVE'; stripeSubscriptionId: string }
  | { status: 'SCHEDULED'; stripeScheduleId: string; currentPeriodEndMillis: number }

export type InvoiceSubscriptionReservation =
  | { kind: 'EXISTING'; request: InvoiceSubscriptionRequest }
  | {
    kind: 'CREATE'
    requestId: string
    customerId: string
    priceId: string
    currentCardSubscription?: { stripeSubscriptionId: string; currentPeriodEndMillis: number }
  }

export interface InvoiceSubscriptionDeps {
  reserveRequest: (orgId: string, actorUid: string) => Promise<InvoiceSubscriptionReservation>
  createSendInvoiceSubscription: (input: {
    customerId: string
    priceId: string
    collectionMethod: 'send_invoice'
    daysUntilDue: 30
    idempotencyKey: string
  }) => Promise<{ stripeSubscriptionId: string }>
  scheduleSendInvoiceAtPeriodEnd: (input: {
    stripeSubscriptionId: string
    customerId: string
    priceId: string
    startDateMillis: number
    collectionMethod: 'send_invoice'
    daysUntilDue: 30
    idempotencyKey: string
  }) => Promise<{ stripeScheduleId: string }>
  finalizeActive: (orgId: string, requestId: string, stripeSubscriptionId: string) => Promise<void>
  finalizeScheduled: (
    orgId: string,
    requestId: string,
    stripeScheduleId: string,
    currentPeriodEndMillis: number,
  ) => Promise<void>
}

export type BillingOverview = {
  profile: BillingProfileInput | null
  paymentMethod: 'CARD' | 'INVOICE' | 'BANK_TRANSFER' | 'MANUAL' | null
  invoiceSubscription?: { status: 'ACTIVE' | 'SCHEDULED'; currentPeriodEndMillis?: number }
  invoices: Array<{
    id: string
    status: 'DRAFT' | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
    paymentMethod: 'INVOICE' | 'BANK_TRANSFER'
    dueDateMillis: number
    hostedInvoiceUrl?: string
  }>
}

const existingResult = (request: InvoiceSubscriptionRequest): StartInvoiceSubscriptionResult => {
  if (request.status === 'ACTIVE' && request.stripeSubscriptionId) {
    return { status: 'ACTIVE', stripeSubscriptionId: request.stripeSubscriptionId }
  }
  if (
    request.status === 'SCHEDULED'
    && request.stripeScheduleId
    && Number.isFinite(request.currentPeriodEndMillis)
  ) {
    return {
      status: 'SCHEDULED',
      stripeScheduleId: request.stripeScheduleId,
      currentPeriodEndMillis: request.currentPeriodEndMillis as number,
    }
  }
  throw new Error('請求書払いの申込を処理中です')
}

export const startInvoiceSubscription = async (
  deps: InvoiceSubscriptionDeps,
  input: { orgId: string; actorUid: string },
): Promise<StartInvoiceSubscriptionResult> => {
  const reservation = await deps.reserveRequest(input.orgId, input.actorUid)
  if (reservation.kind === 'EXISTING') return existingResult(reservation.request)

  const idempotencyKey = `invoice-subscription:${input.orgId}:${reservation.requestId}`
  if (reservation.currentCardSubscription) {
    const { stripeScheduleId } = await deps.scheduleSendInvoiceAtPeriodEnd({
      stripeSubscriptionId: reservation.currentCardSubscription.stripeSubscriptionId,
      customerId: reservation.customerId,
      priceId: reservation.priceId,
      startDateMillis: reservation.currentCardSubscription.currentPeriodEndMillis,
      collectionMethod: 'send_invoice',
      daysUntilDue: 30,
      idempotencyKey,
    })
    await deps.finalizeScheduled(
      input.orgId,
      reservation.requestId,
      stripeScheduleId,
      reservation.currentCardSubscription.currentPeriodEndMillis,
    )
    return {
      status: 'SCHEDULED',
      stripeScheduleId,
      currentPeriodEndMillis: reservation.currentCardSubscription.currentPeriodEndMillis,
    }
  }

  const { stripeSubscriptionId } = await deps.createSendInvoiceSubscription({
    customerId: reservation.customerId,
    priceId: reservation.priceId,
    collectionMethod: 'send_invoice',
    daysUntilDue: 30,
    idempotencyKey,
  })
  await deps.finalizeActive(input.orgId, reservation.requestId, stripeSubscriptionId)
  return { status: 'ACTIVE', stripeSubscriptionId }
}
