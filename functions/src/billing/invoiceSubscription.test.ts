import { describe, expect, it, vi } from 'vitest'
import {
  startInvoiceSubscription,
  type InvoiceSubscriptionDeps,
  type InvoiceSubscriptionReservation,
} from './invoiceSubscription'

const baseReservation: InvoiceSubscriptionReservation = {
  kind: 'CREATE',
  requestId: 'request-1',
  customerId: 'cus_1',
  priceId: 'price_school',
}

const makeDeps = (
  reservation: InvoiceSubscriptionReservation = baseReservation,
): InvoiceSubscriptionDeps => ({
  reserveRequest: vi.fn().mockResolvedValue(reservation),
  createSendInvoiceSubscription: vi.fn().mockResolvedValue({ stripeSubscriptionId: 'sub_invoice' }),
  scheduleSendInvoiceAtPeriodEnd: vi.fn().mockResolvedValue({ stripeScheduleId: 'sub_sched_invoice' }),
  finalizeActive: vi.fn().mockResolvedValue(undefined),
  finalizeScheduled: vi.fn().mockResolvedValue(undefined),
})

describe('startInvoiceSubscription', () => {
  it('returns an existing active request without writing to Stripe', async () => {
    const deps = makeDeps({
      kind: 'EXISTING',
      request: {
        idempotencyKey: 'invoice-subscription:school-1:request-old',
        status: 'ACTIVE',
        requestedByUid: 'uid-old',
        stripeSubscriptionId: 'sub_existing',
      },
    })

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_existing' })
    expect(deps.createSendInvoiceSubscription).not.toHaveBeenCalled()
    expect(deps.scheduleSendInvoiceAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('returns an existing scheduled request without writing to Stripe', async () => {
    const deps = makeDeps({
      kind: 'EXISTING',
      request: {
        idempotencyKey: 'invoice-subscription:school-1:request-old',
        status: 'SCHEDULED',
        requestedByUid: 'uid-old',
        stripeScheduleId: 'sub_sched_existing',
        currentPeriodEndMillis: 1_800_000_000_000,
      },
    })

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({
        status: 'SCHEDULED',
        stripeScheduleId: 'sub_sched_existing',
        currentPeriodEndMillis: 1_800_000_000_000,
      })
    expect(deps.createSendInvoiceSubscription).not.toHaveBeenCalled()
    expect(deps.scheduleSendInvoiceAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('rejects an in-progress request without writing to Stripe', async () => {
    const deps = makeDeps({
      kind: 'EXISTING',
      request: {
        idempotencyKey: 'invoice-subscription:school-1:request-1',
        status: 'CREATING',
        requestedByUid: 'uid-1',
      },
    })

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow('請求書払いの申込を処理中です')
    expect(deps.createSendInvoiceSubscription).not.toHaveBeenCalled()
    expect(deps.scheduleSendInvoiceAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('creates an annual send-invoice subscription with a stable reservation key', async () => {
    const deps = makeDeps()

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({ status: 'ACTIVE', stripeSubscriptionId: 'sub_invoice' })
    expect(deps.createSendInvoiceSubscription).toHaveBeenCalledWith({
      customerId: 'cus_1',
      priceId: 'price_school',
      collectionMethod: 'send_invoice',
      daysUntilDue: 30,
      idempotencyKey: 'invoice-subscription:school-1:request-1',
    })
    expect(deps.finalizeActive).toHaveBeenCalledWith('school-1', 'request-1', 'sub_invoice')
    expect(deps.scheduleSendInvoiceAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('schedules send-invoice billing at the finite card period end', async () => {
    const deps = makeDeps({
      ...baseReservation,
      currentCardSubscription: {
        stripeSubscriptionId: 'sub_card',
        currentPeriodEndMillis: 1_800_000_000_000,
      },
    })

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .resolves.toEqual({
        status: 'SCHEDULED',
        stripeScheduleId: 'sub_sched_invoice',
        currentPeriodEndMillis: 1_800_000_000_000,
      })
    expect(deps.scheduleSendInvoiceAtPeriodEnd).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_card',
      customerId: 'cus_1',
      priceId: 'price_school',
      startDateMillis: 1_800_000_000_000,
      collectionMethod: 'send_invoice',
      daysUntilDue: 30,
      idempotencyKey: 'invoice-subscription:school-1:request-1',
    })
    expect(deps.finalizeScheduled).toHaveBeenCalledWith(
      'school-1',
      'request-1',
      'sub_sched_invoice',
      1_800_000_000_000,
    )
    expect(deps.createSendInvoiceSubscription).not.toHaveBeenCalled()
  })

  it('keeps the reservation unfinalized when Stripe fails so the same key can be retried', async () => {
    const deps = makeDeps()
    vi.mocked(deps.createSendInvoiceSubscription).mockRejectedValueOnce(new Error('Stripe unavailable'))

    await expect(startInvoiceSubscription(deps, { orgId: 'school-1', actorUid: 'uid-1' }))
      .rejects.toThrow('Stripe unavailable')
    expect(deps.createSendInvoiceSubscription).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'invoice-subscription:school-1:request-1',
    }))
    expect(deps.finalizeActive).not.toHaveBeenCalled()
    expect(deps.finalizeScheduled).not.toHaveBeenCalled()
  })
})
