export interface OrderSnapshot {
  orderId: string
  status: 'PENDING' | 'CANCELLED' | 'PROCESSING' | 'FILLED' | 'REJECTED'
  side: 'BUY' | 'SELL'
  stockId: string
  quantity: number
  referencePrice: number
  teamId: string
  lessonRunId: string
}

export interface CancelOrderDeps {
  getOrder: (input: { lessonRunId: string; orderId: string }) => Promise<OrderSnapshot>
  releaseSoftLock: (input: {
    lessonRunId: string; teamId: string; side: 'BUY' | 'SELL'; stockId: string
    quantity: number; referencePrice: number
  }) => Promise<void>
  transition: (input: { lessonRunId: string; orderId: string; from: 'PENDING'; to: 'CANCELLED' }) => Promise<void>
  lessonRunId: string
  orderId: string
}

/**
 * Spec §12.17: only a PENDING order may be cancelled; once a batch has
 * moved it to PROCESSING, cancellation is refused.
 *
 * The `order.status !== 'PENDING'` check below is only an early-return for
 * a good UX message — it reads the order *before* attempting the
 * cancellation, so a batch process (Task 9) could race in and advance the
 * order to PROCESSING between this read and the write below. The actual
 * safety net against double-processing (cancel + settle both succeeding)
 * is `deps.transition`, i.e. Task 5's `transitionOrderStatus`, which
 * performs a `from: 'PENDING'` compare-and-set inside a Firestore
 * transaction: if the batch already moved the order to PROCESSING, that
 * transaction fails and this cancellation fails too, even though this
 * early check passed.
 */
export const cancelOrder = async (deps: CancelOrderDeps): Promise<void> => {
  const order = await deps.getOrder({ lessonRunId: deps.lessonRunId, orderId: deps.orderId })
  if (order.status !== 'PENDING') throw new Error('処理中の注文は取消できません。')

  await deps.releaseSoftLock({
    lessonRunId: order.lessonRunId, teamId: order.teamId, side: order.side,
    stockId: order.stockId, quantity: order.quantity, referencePrice: order.referencePrice,
  })
  // Final defense line — see comment above: this compare-and-set is what
  // actually prevents a cancel/settle race, not the early status check.
  await deps.transition({ lessonRunId: deps.lessonRunId, orderId: deps.orderId, from: 'PENDING', to: 'CANCELLED' })
}
