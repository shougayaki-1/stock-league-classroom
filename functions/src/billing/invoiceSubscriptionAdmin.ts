import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import Stripe from 'stripe'
import { validateBillingProfile, type BillingProfileInput } from './billingProfile'
import {
  startInvoiceSubscription,
  type BillingOverview,
  type InvoiceSubscriptionRequest,
  type InvoiceSubscriptionReservation,
  type StartInvoiceSubscriptionResult,
} from './invoiceSubscription'
import { stripeSecretKey } from './stripeCheckout'

type StoredInvoiceSubscriptionRequest = InvoiceSubscriptionRequest & { requestedAt?: unknown }
type SchedulePhase = Stripe.SubscriptionSchedule['phases'][number]
type SchedulePhaseParams = NonNullable<Stripe.SubscriptionScheduleUpdateParams['phases']>[number]

type ExpandableId = string | { id: string } | null | undefined
type ScheduleDiscount = {
  coupon?: ExpandableId
  discount?: ExpandableId
  promotion_code?: ExpandableId
}

const idFrom = (value: ExpandableId): string | undefined => (
  typeof value === 'string' ? value : value?.id
)

const discountParamsFrom = (discount: ScheduleDiscount):
  { coupon: string } | { discount: string } | { promotion_code: string } | null => {
  const discountId = idFrom(discount.discount)
  if (discountId) return { discount: discountId }
  const promotionCodeId = idFrom(discount.promotion_code)
  if (promotionCodeId) return { promotion_code: promotionCodeId }
  const couponId = idFrom(discount.coupon)
  return couponId ? { coupon: couponId } : null
}

const discountsParamsFrom = (discounts: ScheduleDiscount[]) => discounts
  .map(discountParamsFrom)
  .filter((discount): discount is NonNullable<typeof discount> => discount !== null)

const currentPhaseParamsFrom = (phase: SchedulePhase): SchedulePhaseParams => {
  const couponId = idFrom(phase.coupon)
  return {
  start_date: phase.start_date,
  end_date: phase.end_date,
  add_invoice_items: phase.add_invoice_items.map((item) => ({
    price: idFrom(item.price),
    ...(typeof item.quantity === 'number' ? { quantity: item.quantity } : {}),
    discounts: discountsParamsFrom(item.discounts),
    ...(item.tax_rates ? { tax_rates: item.tax_rates.map((taxRate) => taxRate.id) } : {}),
  })),
  ...(typeof phase.application_fee_percent === 'number'
    ? { application_fee_percent: phase.application_fee_percent }
    : {}),
  ...(phase.automatic_tax
    ? {
      automatic_tax: {
        enabled: phase.automatic_tax.enabled,
        ...(phase.automatic_tax.liability
          ? {
            liability: {
              type: phase.automatic_tax.liability.type,
              ...(idFrom(phase.automatic_tax.liability.account)
                ? { account: idFrom(phase.automatic_tax.liability.account) }
                : {}),
            },
          }
          : {}),
      },
    }
    : {}),
  ...(phase.billing_cycle_anchor ? { billing_cycle_anchor: phase.billing_cycle_anchor } : {}),
  ...(phase.billing_thresholds
    ? {
      billing_thresholds: {
        ...(typeof phase.billing_thresholds.amount_gte === 'number'
          ? { amount_gte: phase.billing_thresholds.amount_gte }
          : {}),
        ...(typeof phase.billing_thresholds.reset_billing_cycle_anchor === 'boolean'
          ? { reset_billing_cycle_anchor: phase.billing_thresholds.reset_billing_cycle_anchor }
          : {}),
      },
    }
    : {}),
  ...(phase.collection_method ? { collection_method: phase.collection_method } : {}),
  ...(couponId ? { coupon: couponId } : {}),
  currency: phase.currency,
  ...(idFrom(phase.default_payment_method)
    ? { default_payment_method: idFrom(phase.default_payment_method) }
    : {}),
  ...(phase.default_tax_rates
    ? { default_tax_rates: phase.default_tax_rates.map((taxRate) => taxRate.id) }
    : {}),
  ...(phase.description !== null ? { description: phase.description } : {}),
  discounts: discountsParamsFrom(phase.discounts),
  ...(phase.invoice_settings
    ? {
      invoice_settings: {
        ...(phase.invoice_settings.account_tax_ids
          ? { account_tax_ids: phase.invoice_settings.account_tax_ids.map((taxId) => idFrom(taxId) as string) }
          : {}),
        ...(typeof phase.invoice_settings.days_until_due === 'number'
          ? { days_until_due: phase.invoice_settings.days_until_due }
          : {}),
        ...(phase.invoice_settings.issuer
          ? {
            issuer: {
              type: phase.invoice_settings.issuer.type,
              ...(idFrom(phase.invoice_settings.issuer.account)
                ? { account: idFrom(phase.invoice_settings.issuer.account) }
                : {}),
            },
          }
          : {}),
      },
    }
    : {}),
  items: phase.items.map((item) => ({
    price: idFrom(item.price),
    ...(typeof item.quantity === 'number' ? { quantity: item.quantity } : {}),
    ...(item.billing_thresholds && typeof item.billing_thresholds.usage_gte === 'number'
      ? { billing_thresholds: { usage_gte: item.billing_thresholds.usage_gte } }
      : {}),
    discounts: discountsParamsFrom(item.discounts),
    ...(item.metadata ? { metadata: item.metadata } : {}),
    ...(item.tax_rates ? { tax_rates: item.tax_rates.map((taxRate) => taxRate.id) } : {}),
  })),
  ...(phase.metadata ? { metadata: phase.metadata } : {}),
  ...(idFrom(phase.on_behalf_of) ? { on_behalf_of: idFrom(phase.on_behalf_of) } : {}),
  proration_behavior: phase.proration_behavior,
  ...(phase.transfer_data
    ? {
      transfer_data: {
        destination: idFrom(phase.transfer_data.destination) as string,
        ...(typeof phase.transfer_data.amount_percent === 'number'
          ? { amount_percent: phase.transfer_data.amount_percent }
          : {}),
      },
    }
    : {}),
  ...(typeof phase.trial_end === 'number' ? { trial_end: phase.trial_end } : {}),
  }
}

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
  if (idFrom(subscription.customer) !== reserved.customerId) {
    throw new Error('カード契約のCustomerが請求先と一致しません')
  }
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
        proration_behavior: 'none',
        phases: [
          currentPhaseParamsFrom(currentPhase),
          {
            start_date: startDateSeconds,
            items: [{ price: priceId, quantity: 1 }],
            collection_method: collectionMethod,
            invoice_settings: { days_until_due: daysUntilDue },
            metadata: { orgId: input.orgId, billingMode: 'invoice' },
            proration_behavior: 'none',
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

type BillingRecordData = Record<string, unknown>
type BillingOverviewInvoice = BillingOverview['invoices'][number]
type BillingPaymentMethod = BillingOverview['paymentMethod']

const billingStatuses = new Set<BillingOverviewInvoice['status']>([
  'DRAFT',
  'PENDING',
  'PAID',
  'OVERDUE',
  'CANCELLED',
])
const invoicePaymentMethods = new Set<BillingOverviewInvoice['paymentMethod']>([
  'INVOICE',
  'BANK_TRANSFER',
])
const billingPaymentMethods = new Set<NonNullable<BillingPaymentMethod>>([
  'CARD',
  'INVOICE',
  'BANK_TRANSFER',
  'MANUAL',
])

const sanitizedProfileFrom = (value: unknown): BillingProfileInput | null => {
  try {
    return validateBillingProfile(value)
  } catch {
    return null
  }
}

const invoiceSubscriptionFrom = (
  value: unknown,
): BillingOverview['invoiceSubscription'] | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const request = value as Record<string, unknown>
  if (request.status === 'ACTIVE') return { status: 'ACTIVE' }
  if (request.status !== 'SCHEDULED') return undefined
  return {
    status: 'SCHEDULED',
    ...(typeof request.currentPeriodEndMillis === 'number' && Number.isFinite(request.currentPeriodEndMillis)
      ? { currentPeriodEndMillis: request.currentPeriodEndMillis }
      : {}),
  }
}

const sanitizedInvoiceFrom = (
  id: string,
  data: BillingRecordData,
): { invoice: BillingOverviewInvoice; stripeInvoiceId: string } | null => {
  if (
    !billingStatuses.has(data.status as BillingOverviewInvoice['status'])
    || !invoicePaymentMethods.has(data.paymentMethod as BillingOverviewInvoice['paymentMethod'])
    || typeof data.dueDateMillis !== 'number'
    || !Number.isFinite(data.dueDateMillis)
    || typeof data.stripeInvoiceId !== 'string'
    || !data.stripeInvoiceId
  ) return null

  return {
    invoice: {
      id,
      status: data.status as BillingOverviewInvoice['status'],
      paymentMethod: data.paymentMethod as BillingOverviewInvoice['paymentMethod'],
      dueDateMillis: data.dueDateMillis,
    },
    stripeInvoiceId: data.stripeInvoiceId,
  }
}

const currentPaymentMethodFrom = (
  organization: BillingRecordData,
  records: BillingRecordData[],
  invoiceSubscription: BillingOverview['invoiceSubscription'],
): BillingPaymentMethod => {
  if (billingPaymentMethods.has(organization.paymentMethod as NonNullable<BillingPaymentMethod>)) {
    return organization.paymentMethod as NonNullable<BillingPaymentMethod>
  }
  if (invoiceSubscription?.status === 'ACTIVE') {
    const invoiceMethod = records.find((record) => (
      invoicePaymentMethods.has(record.paymentMethod as BillingOverviewInvoice['paymentMethod'])
    ))?.paymentMethod
    return invoiceMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'INVOICE'
  }
  if (invoiceSubscription?.status === 'SCHEDULED') return 'CARD'
  const storedMethod = records.find((record) => (
    billingPaymentMethods.has(record.paymentMethod as NonNullable<BillingPaymentMethod>)
  ))?.paymentMethod
  if (billingPaymentMethods.has(storedMethod as NonNullable<BillingPaymentMethod>)) {
    return storedMethod as NonNullable<BillingPaymentMethod>
  }
  return null
}

export const getBillingOverviewWithAdminSdk = async (
  input: { orgId: string },
): Promise<BillingOverview> => {
  const db = getFirestore()
  const organizationSnapshot = await db.doc(`organizations/${input.orgId}`).get()
  const organization = organizationSnapshot.exists
    ? (organizationSnapshot.data() as BillingRecordData | undefined) ?? {}
    : {}
  if (organization.type !== 'school') throw new Error('請求書払いは学校組織のみ利用できます')

  const billingRecordsSnapshot = await db.collection(`organizations/${input.orgId}/billingRecords`).get()
  const records = billingRecordsSnapshot.docs.map((document) => document.data() as BillingRecordData)
  const invoiceSubscription = invoiceSubscriptionFrom(organization.invoiceSubscriptionRequest)
  const invoicesWithStripeIds = billingRecordsSnapshot.docs
    .map((document) => sanitizedInvoiceFrom(document.id, document.data() as BillingRecordData))
    .filter((invoice): invoice is NonNullable<typeof invoice> => invoice !== null)

  const stripe = new Stripe(stripeSecretKey.value())
  const stripeInvoices = await Promise.all(invoicesWithStripeIds.map(async ({ stripeInvoiceId }) => {
    const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId)
    return {
      stripeInvoiceId,
      stripeInvoice,
    }
  }))
  const ownedStripeInvoiceIds = new Set(stripeInvoices
    .filter(({ stripeInvoice }) => (
      typeof organization.stripeCustomerId === 'string'
      && idFrom(stripeInvoice.customer) === organization.stripeCustomerId
    ))
    .map(({ stripeInvoiceId }) => stripeInvoiceId))
  const ownedRecords = records.filter((record) => (
    typeof record.stripeInvoiceId !== 'string'
    || ownedStripeInvoiceIds.has(record.stripeInvoiceId)
  ))
  const invoices = invoicesWithStripeIds
    .filter(({ stripeInvoiceId }) => ownedStripeInvoiceIds.has(stripeInvoiceId))
    .map(({ invoice, stripeInvoiceId }) => {
      const stripeInvoice = stripeInvoices.find((item) => item.stripeInvoiceId === stripeInvoiceId)?.stripeInvoice
      return {
        ...invoice,
        ...(typeof stripeInvoice?.hosted_invoice_url === 'string' && stripeInvoice.hosted_invoice_url
          ? { hostedInvoiceUrl: stripeInvoice.hosted_invoice_url }
          : {}),
      }
    })

  return {
    profile: sanitizedProfileFrom(organization.billingProfile),
    paymentMethod: currentPaymentMethodFrom(organization, ownedRecords, invoiceSubscription),
    ...(invoiceSubscription ? { invoiceSubscription } : {}),
    invoices: invoices.sort((left, right) => right.dueDateMillis - left.dueDateMillis),
  }
}
