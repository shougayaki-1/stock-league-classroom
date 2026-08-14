import { httpsCallable, type Functions } from 'firebase/functions'

export type BillingProfileInput = {
  legalName: string
  contactName: string
  email: string
  address: {
    postalCode: string
    prefecture: string
    city: string
    line1: string
    line2?: string
  }
}

export type StartInvoiceSubscriptionResult =
  | { status: 'ACTIVE'; stripeSubscriptionId: string }
  | { status: 'SCHEDULED'; stripeScheduleId: string; currentPeriodEndMillis: number }

export type BillingOverview = {
  profile: BillingProfileInput | null
  paymentMethod: 'CARD' | 'INVOICE' | 'BANK_TRANSFER' | 'MANUAL' | null
  invoiceSubscription?: {
    status: 'ACTIVE' | 'SCHEDULED'
    currentPeriodEndMillis?: number
  }
  invoices: Array<{
    id: string
    status: 'DRAFT' | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
    paymentMethod: 'INVOICE' | 'BANK_TRANSFER'
    dueDateMillis: number
    hostedInvoiceUrl?: string
  }>
}

export const saveBillingProfile = async (
  functions: Functions,
  input: { orgId: string; profile: BillingProfileInput },
): Promise<{ stripeCustomerId: string }> =>
  (await httpsCallable<typeof input, { stripeCustomerId: string }>(functions, 'saveBillingProfileCallable')(input)).data

export const startInvoiceSubscription = async (
  functions: Functions,
  input: { orgId: string },
): Promise<StartInvoiceSubscriptionResult> =>
  (await httpsCallable<typeof input, StartInvoiceSubscriptionResult>(functions, 'startInvoiceSubscriptionCallable')(input)).data

export const getBillingOverview = async (
  functions: Functions,
  input: { orgId: string },
): Promise<BillingOverview> =>
  (await httpsCallable<typeof input, BillingOverview>(functions, 'getBillingOverviewCallable')(input)).data
