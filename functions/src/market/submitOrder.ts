export interface SubmitOrderDeps {
  isMarketAcceptingOrders: () => boolean
  applySoftLock: (input: {
    lessonRunId: string; teamId: string; side: 'BUY' | 'SELL'; stockId: string
    quantity: number; referencePrice: number
  }) => Promise<{ accepted: true } | { accepted: false; reason: string }>
  createOrder: (input: {
    lessonRunId: string; batchId: string; teamId: string; stockId: string
    side: 'BUY' | 'SELL'; quantity: number; referencePrice: number; idempotencyKey: string
  }) => Promise<{ orderId: string; created: boolean }>
  lessonRunId: string
  batchId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  quantity: number
  referencePrice: number
  idempotencyKey: string
}

/**
 * Order submission entry point — spec §12.13 (idempotency, via
 * `createOrder`), §12.16 (soft lock, via `applySoftLock`), §12.25 (market
 * paused rejects new orders). Pure DI: the Callable boundary
 * (`onCall.ts`) wires `isMarketAcceptingOrders`/`applySoftLock`/`createOrder`
 * to the Admin SDK and translates thrown `Error`s into `HttpsError`s.
 *
 * Order matters: the market-paused check happens before anything else, and
 * the soft lock must be accepted before `createOrder` runs, so a rejected
 * order is never persisted (matches the brief's "注文を受け付けない" intent).
 */
export const submitOrder = async (deps: SubmitOrderDeps): Promise<{ orderId: string; created: boolean }> => {
  if (!deps.isMarketAcceptingOrders()) throw new Error('市場は停止中です。新規注文は受け付けられません。')

  const lockResult = await deps.applySoftLock({
    lessonRunId: deps.lessonRunId, teamId: deps.teamId, side: deps.side,
    stockId: deps.stockId, quantity: deps.quantity, referencePrice: deps.referencePrice,
  })
  if (!lockResult.accepted) throw new Error(lockResult.reason)

  return deps.createOrder({
    lessonRunId: deps.lessonRunId, batchId: deps.batchId, teamId: deps.teamId,
    stockId: deps.stockId, side: deps.side, quantity: deps.quantity,
    referencePrice: deps.referencePrice, idempotencyKey: deps.idempotencyKey,
  })
}
