import { doc, setDoc, type Firestore } from 'firebase/firestore'
import { get, onDisconnect, ref, runTransaction, type Database } from 'firebase/database'
import { clampToBounds, createPhaseRuntime, elapsedMarketMinute, getActivePhase } from '../pricing/pricingCore'
import type { StockPricePhase } from '../pricing/types'
import type { HostLease, LiveMarketState, OrderResult, PendingOrder, Portfolio, TeamLeaderboardEntry } from './liveMarketTypes'

export const root = (marketId: string) => `liveMarkets/${marketId}`
const now = () => Date.now()
const clone = <T>(value: T): T => structuredClone(value)
export const hostLeasePath = (marketId: string) => `${root(marketId)}/hostLease`
export const hostDisconnectPath = (marketId: string, leaseId: string) => `${root(marketId)}/hostDisconnects/${leaseId}`
export const ownsLiveLease = (raw: LiveMarketState, ownerUid: string, leaseId: string, atMillis: number) => raw.meta.ownerUid === ownerUid && raw.hostLease?.leaseId === leaseId && !raw.hostLease.paused && raw.hostLease.expiresAtMillis > atMillis
/** Kept pure so the L1 -> L2 -> L1-disconnect safety invariant is directly testable. */
export const shouldPauseLease = (raw: LiveMarketState, ownerUid: string, leaseId: string, atMillis: number) => ownsLiveLease(raw, ownerUid, leaseId, atMillis) && Boolean(raw.hostDisconnects?.[leaseId])

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

/** Renewal is lease-ID-bound: an older browser session can never reclaim a newer lease. */
export const renewHostLease = async (database: Database, marketId: string, ownerUid: string, leaseId: string, ttlMillis = 15_000, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || raw.meta.status === 'ENDED' || !ownsLiveLease(raw, ownerUid, leaseId, atMillis)) return
    raw.hostLease!.expiresAtMillis = atMillis + ttlMillis; return raw
  })
  return result.committed
}

export const openMarket = async (database: Database, marketId: string, ownerUid: string, leaseId: string) => runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
  if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, now()) || raw.meta.status !== 'SETUP') return
  raw.meta.status = 'OPEN'; raw.meta.openedAtMillis ??= now(); return raw
})

/** A reachable host action transitions OPEN to ENDING; the tick performs/retries finalization. */
export const requestMarketEnding = async (database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
  if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return
  raw.meta.status = 'ENDING'; raw.finalization ??= { status: 'PENDING', checkpointId: `ending-${atMillis}`, startedAtMillis: atMillis }; return raw
})

/** A disconnect writes a lease-specific marker; a later root transaction pauses only if it is still current. */
export const armHostLeaseDisconnect = async (database: Database, marketId: string, lease: HostLease) => {
  await onDisconnect(ref(database, hostDisconnectPath(marketId, lease.leaseId))).set({ ownerUid: lease.ownerUid, disconnectedAtMillis: now() })
}

export const pauseDisconnectedLease = async (database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
  if (!raw || !shouldPauseLease(raw, ownerUid, leaseId, atMillis)) return
  raw.hostLease!.paused = true; return raw
})

export const publishPrices = async (database: Database, marketId: string, ownerUid: string, leaseId: string, stocks: Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }>, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return
    raw.prices ??= {}
    for (const stock of stocks) {
      const existing = raw.prices[stock.id]
      const current = existing?.price ?? stock.basePrice
      const openedAtMillis = raw.meta.openedAtMillis ?? atMillis
      const phase = getActivePhase(stock.phases ?? [], elapsedMarketMinute(openedAtMillis, atMillis))
      const runtime = existing?.runtime && existing.runtime.phaseId === phase.id && existing.runtime.endAtMillis > atMillis ? existing.runtime : createPhaseRuntime(current, phase, openedAtMillis, atMillis, stock.basePrice, 0)
      raw.prices[stock.id] = { price: priceAtRuntime(runtime, stock.basePrice, atMillis), updatedAtMillis: atMillis, runtime }
    }
    return raw
  })
  return result.committed
}

export const submitOrder = async (database: Database, marketId: string, participantId: string, order: PendingOrder) =>
  runTransaction(ref(database, `${root(marketId)}/orders/${participantId}/pending`), (current: PendingOrder | null) => current?.orderId === order.orderId ? current : current ? undefined : order)

/** Pure order policy: host price wins and a request is reduced, never rejected, for insufficient funds/holdings. */
export const calculateOrderFill = (order: PendingOrder, price: number, portfolio: Portfolio, atMillis: number, participantId = '', teamId = ''): OrderResult => {
  const requested = Math.max(0, Math.floor(order.quantity)); const held = portfolio.holdings?.[order.stockId] ?? 0
  const filled = order.side === 'BUY' ? Math.min(requested, Math.floor(portfolio.cash / price)) : Math.min(requested, held)
  return { orderId: order.orderId, participantId, teamId, stockId: order.stockId, side: order.side, requestedQuantity: requested, filledQuantity: filled, price, processedAtMillis: atMillis }
}

export const priceAtRuntime = (runtime: { startPrice: number; endPrice: number; startAtMillis: number; endAtMillis: number }, basePrice: number, atMillis: number) => {
  const duration = Math.max(1, runtime.endAtMillis - runtime.startAtMillis)
  const ratio = Math.min(1, Math.max(0, (atMillis - runtime.startAtMillis) / duration))
  return clampToBounds(runtime.startPrice + (runtime.endPrice - runtime.startPrice) * ratio, basePrice)
}

/** One root transaction consumes the pending order and records its only possible result. */
export const processPendingOrder = async (database: Database, marketId: string, ownerUid: string, leaseId: string, participantId: string, atMillis = now()) => {
  let processed: OrderResult | undefined
  const result = await runTransaction(ref(database, root(marketId)), (input: LiveMarketState | null) => {
    if (!input || !ownsLiveLease(input, ownerUid, leaseId, atMillis) || input.meta.status !== 'OPEN') return
    const raw = clone(input); const order = raw.orders?.[participantId]?.pending
    if (!order) return raw
    if (raw.transactions?.[participantId]?.[order.orderId]) { delete raw.orders?.[participantId]?.pending; return raw }
    const participant = raw.participants?.[participantId]
    const teamId = participant?.teamId
    const price = raw.prices?.[order.stockId]?.price
    if (!participant || !teamId) { delete raw.orders?.[participantId]?.pending; return raw }
    if (!price || price <= 0) return raw
    raw.teamPortfolios ??= {}; const portfolio = raw.teamPortfolios[teamId] ?? { cash: raw.meta.startingCash, holdings: {}, updatedAtMillis: atMillis }
    portfolio.holdings ??= {}
    const orderResult = calculateOrderFill(order, price, portfolio, atMillis, participantId, teamId); processed = orderResult
    if (order.side === 'BUY') { portfolio.cash -= orderResult.filledQuantity * price; portfolio.holdings[order.stockId] = (portfolio.holdings[order.stockId] ?? 0) + orderResult.filledQuantity }
    else { portfolio.cash += orderResult.filledQuantity * price; portfolio.holdings[order.stockId] = Math.max(0, (portfolio.holdings[order.stockId] ?? 0) - orderResult.filledQuantity) }
    portfolio.updatedAtMillis = atMillis; raw.teamPortfolios[teamId] = portfolio
    raw.transactions ??= {}; raw.transactions[participantId] ??= {}; raw.transactions[participantId][order.orderId] = orderResult
    delete raw.orders?.[participantId]?.pending
    return raw
  })
  return { committed: result.committed, result: processed }
}

export const rankTeams = (
  state: Pick<LiveMarketState, 'teams' | 'participants' | 'teamPortfolios' | 'prices'>,
): Record<string, TeamLeaderboardEntry> => {
  const activeTeamIds = new Set(Object.values(state.participants ?? {}).map((participant) => participant.teamId).filter((teamId): teamId is string => Boolean(teamId)))
  const entries = [...activeTeamIds].map((teamId) => {
    const portfolio = state.teamPortfolios?.[teamId] ?? { cash: 0, holdings: {}, updatedAtMillis: 0 }
    const valuation = Math.round(portfolio.cash + Object.entries(portfolio.holdings ?? {}).reduce((sum, [stockId, quantity]) => sum + quantity * (state.prices?.[stockId]?.price ?? 0), 0))
    return { teamId, name: state.teams[teamId]?.name ?? teamId, valuation, rank: 0 }
  }).sort((a, b) => b.valuation - a.valuation || a.name.localeCompare(b.name, 'ja'))
  let previousValuation: number | undefined
  let previousRank = 0
  entries.forEach((entry, index) => {
    if (entry.valuation !== previousValuation) previousRank = index + 1
    entry.rank = previousRank
    previousValuation = entry.valuation
  })
  return Object.fromEntries(entries.map((entry) => [entry.teamId, entry]))
}

export const publishMarketProjections = async (database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis)) return
    raw.teamLeaderboard = rankTeams(raw)
    const leaderboard = Object.values(raw.teamLeaderboard).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ja')).map(({ name, valuation, rank }) => ({ name, valuation, rank }))
    raw.signage = {
      joinCode: raw.meta.joinCode,
      prices: raw.meta.visibility === 'public' ? Object.entries(raw.prices ?? {}).map(([stockId, value]) => ({ stockId, stockName: raw.companies?.[stockId]?.name ?? stockId, price: value.price })) : [],
      publicNews: raw.meta.visibility === 'public' ? Object.values(raw.news ?? {}).sort((a, b) => a.publishedAtMillis - b.publishedAtMillis).map((item) => item.message) : [],
      phase: raw.meta.status,
      leaderboard: raw.meta.visibility === 'private' ? [] : leaderboard,
    }
    return raw
  })
  return result.committed
}

export const NEWS_IMPACT_LIMIT = 20

/**
 * A shock has to move the phase runtime, not just the price: publishPrices
 * recomputes each price from its runtime every tick, so a bare price write
 * would be erased one second later.
 */
export const applyNewsImpact = (state: Pick<LiveMarketState, 'prices' | 'companies'>, impactPercent: number, atMillis: number) => {
  const bounded = Math.max(-NEWS_IMPACT_LIMIT, Math.min(NEWS_IMPACT_LIMIT, impactPercent))
  if (!bounded || !state.prices) return
  const multiplier = 1 + bounded / 100
  for (const [stockId, entry] of Object.entries(state.prices)) {
    const basePrice = state.companies?.[stockId]?.basePrice ?? entry.price
    entry.price = clampToBounds(entry.price * multiplier, basePrice)
    entry.updatedAtMillis = atMillis
    if (entry.runtime) {
      entry.runtime.startPrice = clampToBounds(entry.runtime.startPrice * multiplier, basePrice)
      entry.runtime.endPrice = clampToBounds(entry.runtime.endPrice * multiplier, basePrice)
    }
  }
}

export const publishManualNews = async (database: Database, marketId: string, ownerUid: string, leaseId: string, message: string, impactPercent = 0, atMillis = now()) => {
  const trimmed = message.trim().slice(0, 280); if (!trimmed) throw new Error('News must not be empty')
  return runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status !== 'OPEN') return
    raw.news ??= {}; raw.news[crypto.randomUUID()] = { message: trimmed, publishedAtMillis: atMillis, impactPercent }
    applyNewsImpact(raw, impactPercent, atMillis)
    return raw
  })
}

/** Firestore result docs are deterministic IDs, so retried ENDING recovery overwrites identical snapshots safely. */
export const finalizeEnding = async (firestore: Firestore, database: Database, marketId: string, ownerUid: string, leaseId: string, atMillis = now()) => {
  let checkpoint = ''
  const entered = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.meta.status === 'ENDED') return
    raw.meta.status = 'ENDING'; raw.finalization ??= { status: 'PENDING', checkpointId: `ending-${atMillis}`, startedAtMillis: atMillis }; checkpoint = raw.finalization.checkpointId; return raw
  })
  if (!entered.committed) return false
  const snapshot = entered.snapshot.val() as LiveMarketState
  const leaderboard = rankTeams(snapshot)
  const teamWrites = Object.entries(snapshot.teamPortfolios ?? {}).map(([teamId, portfolio]) =>
    setDoc(doc(firestore, 'marketResults', marketId, 'teams', teamId), { ownerUid, checkpointId: checkpoint, teamId, portfolio, leaderboard: leaderboard[teamId] ?? null, finalizedAtMillis: atMillis }))
  const participantWrites = Object.entries(snapshot.participants ?? {}).map(([participantId, participant]) =>
    setDoc(doc(firestore, 'marketResults', marketId, 'participants', participantId), {
      ownerUid, checkpointId: checkpoint, participantId, participantUid: participant.uid, teamId: participant.teamId,
      // Carried into the result so the teacher's CSV names a student, not a UID.
      displayName: participant.displayName,
      teamResult: participant.teamId ? leaderboard[participant.teamId] ?? null : null,
      transactions: snapshot.transactions?.[participantId] ?? {}, finalizedAtMillis: atMillis,
    }))
  const writes = [...teamWrites, ...participantWrites]
  for (let index = 0; index < writes.length; index += 20) await Promise.all(writes.slice(index, index + 20))
  const complete = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis) || raw.finalization?.checkpointId !== checkpoint) return
    raw.meta.status = 'ENDED'; raw.finalization.status = 'COMPLETED'; raw.finalization.completedAtMillis = atMillis
    if (raw.signage) raw.signage.phase = 'ENDED'
    return raw
  })
  return complete.committed
}

/** One second of host work. The caller starts it only after acquiring a specific lease. */
export const runHostTick = async (firestore: Firestore, database: Database, marketId: string, ownerUid: string, leaseId: string, stocks: Array<{ id: string; basePrice: number; phases?: StockPricePhase[] }>, atMillis = now()) => {
  await pauseDisconnectedLease(database, marketId, ownerUid, leaseId, atMillis)
  if (!await renewHostLease(database, marketId, ownerUid, leaseId, 15_000, atMillis)) return false
  await publishPrices(database, marketId, ownerUid, leaseId, stocks, atMillis)
  const snapshot = (await get(ref(database, root(marketId)))).val() as LiveMarketState | null
  if (!snapshot || snapshot.meta.status === 'ENDED' || !ownsLiveLease(snapshot, ownerUid, leaseId, atMillis)) return false
  for (const participantId of Object.keys(snapshot.orders ?? {})) await processPendingOrder(database, marketId, ownerUid, leaseId, participantId, atMillis)
  await publishMarketProjections(database, marketId, ownerUid, leaseId, atMillis)
  if (snapshot.meta.status === 'ENDING') await finalizeEnding(firestore, database, marketId, ownerUid, leaseId, atMillis)
  return true
}
