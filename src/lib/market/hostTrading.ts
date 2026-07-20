import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { onDisconnect, ref, runTransaction, type Database } from 'firebase/database'
import { clampToBounds, createPhaseRuntime, getActivePhase } from '../pricing/pricingCore'
import type { StockPricePhase } from '../pricing/types'
import type { HostLease, LiveMarketState, OrderResult, PendingOrder, Portfolio } from './liveMarketTypes'

const root = (marketId: string) => `liveMarkets/${marketId}`
const now = () => Date.now()
const clone = <T>(value: T): T => structuredClone(value)
export const hostLeasePath = (marketId: string) => `${root(marketId)}/hostLease`

/** The market owner is the only eligible host.  Transactions make simultaneous lease claims deterministic. */
export const acquireHostLease = async (database: Database, marketId: string, ownerUid: string, leaseId: string, ttlMillis = 15_000, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.ownerUid !== ownerUid || raw.meta.status === 'ENDED') return
    const lease = raw.hostLease
    if (lease && lease.ownerUid !== ownerUid && lease.expiresAtMillis > atMillis) return
    raw.hostLease = { ownerUid, leaseId, expiresAtMillis: atMillis + ttlMillis, paused: false }
    return raw
  })
  return result.committed
}

export const openMarket = async (database: Database, marketId: string, ownerUid: string, leaseId: string) => runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
  if (!raw || raw.meta.ownerUid !== ownerUid || raw.hostLease?.leaseId !== leaseId || raw.hostLease.paused || raw.meta.status !== 'SETUP') return
  raw.meta.status = 'OPEN'; return raw
})

/** Queue the disconnect action before relying on a lease; it can only pause the exact acquired lease. */
export const armHostLeaseDisconnect = async (database: Database, marketId: string, lease: HostLease) => {
  await onDisconnect(ref(database, hostLeasePath(marketId))).set({ ...lease, paused: true })
}

export const publishPrices = async (database: Database, marketId: string, ownerUid: string, leaseId: string, stocks: Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }>, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.ownerUid !== ownerUid || raw.hostLease?.leaseId !== leaseId || raw.hostLease.paused || raw.hostLease.expiresAtMillis <= atMillis || raw.meta.status !== 'OPEN') return
    raw.prices ??= {}
    for (const stock of stocks) {
      const current = raw.prices[stock.id]?.price ?? stock.basePrice
      const phase = getActivePhase(stock.phases ?? [], atMillis)
      const runtime = createPhaseRuntime(current, phase, atMillis, stock.basePrice, 0)
      const duration = Math.max(1, runtime.endAtMillis - runtime.startAtMillis)
      const ratio = Math.min(1, Math.max(0, (atMillis - runtime.startAtMillis) / duration))
      raw.prices[stock.id] = { price: clampToBounds(runtime.startPrice + (runtime.endPrice - runtime.startPrice) * ratio, stock.basePrice), updatedAtMillis: atMillis }
    }
    return raw
  })
  return result.committed
}

export const submitOrder = async (database: Database, marketId: string, participantId: string, order: PendingOrder) =>
  runTransaction(ref(database, `${root(marketId)}/orders/${participantId}/pending`), (current: PendingOrder | null) => current?.orderId === order.orderId ? current : current ? undefined : order)

/** Pure order policy: host price wins and a request is reduced, never rejected, for insufficient funds/holdings. */
export const calculateOrderFill = (order: PendingOrder, price: number, portfolio: Portfolio, atMillis: number): OrderResult => {
  const requested = Math.max(0, Math.floor(order.quantity)); const held = portfolio.holdings[order.stockId] ?? 0
  const filled = order.side === 'BUY' ? Math.min(requested, Math.floor(portfolio.cash / price)) : Math.min(requested, held)
  return { orderId: order.orderId, stockId: order.stockId, side: order.side, requestedQuantity: requested, filledQuantity: filled, price, processedAtMillis: atMillis }
}

/** One root transaction consumes the pending order and records its only possible result. */
export const processPendingOrder = async (database: Database, marketId: string, ownerUid: string, leaseId: string, participantId: string, atMillis = now()) => {
  let processed: OrderResult | undefined
  const result = await runTransaction(ref(database, root(marketId)), (input: LiveMarketState | null) => {
    if (!input || input.meta.ownerUid !== ownerUid || input.hostLease?.leaseId !== leaseId || input.hostLease.paused || input.hostLease.expiresAtMillis <= atMillis || input.meta.status !== 'OPEN') return
    const raw = clone(input); const order = raw.orders?.[participantId]?.pending
    if (!order) return raw
    if (raw.transactions?.[participantId]?.[order.orderId]) { delete raw.orders?.[participantId]?.pending; return raw }
    const price = raw.prices?.[order.stockId]?.price
    if (!price || price <= 0) return raw
    raw.portfolios ??= {}; const portfolio = raw.portfolios[participantId] ?? { cash: 0, holdings: {}, updatedAtMillis: atMillis }
    const orderResult = calculateOrderFill(order, price, portfolio, atMillis); processed = orderResult
    if (order.side === 'BUY') { portfolio.cash -= orderResult.filledQuantity * price; portfolio.holdings[order.stockId] = (portfolio.holdings[order.stockId] ?? 0) + orderResult.filledQuantity }
    else { portfolio.cash += orderResult.filledQuantity * price; portfolio.holdings[order.stockId] = Math.max(0, (portfolio.holdings[order.stockId] ?? 0) - orderResult.filledQuantity) }
    portfolio.updatedAtMillis = atMillis; raw.portfolios[participantId] = portfolio
    raw.transactions ??= {}; raw.transactions[participantId] ??= {}; raw.transactions[participantId][order.orderId] = orderResult
    delete raw.orders?.[participantId]?.pending
    return raw
  })
  return { committed: result.committed, result: processed }
}

export const publishManualNews = async (database: Database, marketId: string, ownerUid: string, leaseId: string, message: string, atMillis = now()) => {
  const trimmed = message.trim().slice(0, 280); if (!trimmed) throw new Error('News must not be empty')
  return runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.ownerUid !== ownerUid || raw.hostLease?.leaseId !== leaseId || raw.hostLease.paused || raw.meta.status !== 'OPEN') return
    raw.news ??= {}; raw.news[String(atMillis)] = { message: trimmed, publishedAtMillis: atMillis }; return raw
  })
}

/** Firestore result docs are deterministic IDs, so retried ENDING recovery overwrites identical snapshots safely. */
export const finalizeEnding = async (firestore: Firestore, database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => {
  let checkpoint = ''
  const entered = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.ownerUid !== ownerUid || raw.hostLease?.leaseId !== leaseId || raw.hostLease.paused || raw.meta.status === 'ENDED') return
    raw.meta.status = 'ENDING'; raw.finalization ??= { status: 'PENDING', checkpointId: `ending-${atMillis}`, startedAtMillis: atMillis }; checkpoint = raw.finalization.checkpointId; return raw
  })
  if (!entered.committed) return false
  const snapshot = entered.snapshot.val() as LiveMarketState
  for (const [participantId, portfolio] of Object.entries(snapshot.portfolios ?? {})) await setDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId), { ownerUid, checkpointId: checkpoint, participantId, participantUid: snapshot.participants?.[participantId]?.uid ?? '', portfolio, transactions: snapshot.transactions?.[participantId] ?? {}, finalizedAtMillis: atMillis })
  const complete = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.ownerUid !== ownerUid || raw.finalization?.checkpointId !== checkpoint) return
    raw.meta.status = 'ENDED'; raw.finalization.status = 'COMPLETED'; raw.finalization.completedAtMillis = atMillis; return raw
  })
  return complete.committed
}
