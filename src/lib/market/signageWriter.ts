import { ref, runTransaction, type Database } from 'firebase/database'
import { ownsLiveLease, root } from './hostTrading'
import type { LiveMarketState, MarketStatus } from './liveMarketTypes'

export interface SignageData {
  prices: { stockId: string; stockName: string; price: number }[]
  publicNews: string[]
  phase: MarketStatus
  // Distinct from the liveMarkets/{marketId}/leaderboard RTDB node (database.rules.json) — this is the signage-display projection (no per-entry rank); do not assume the two are interchangeable.
  leaderboard: { name: string; valuation: number }[]
}

/** Signage is host-authored and pre-aggregated: never raw portfolios or per-student cash/holdings. */
export const writeSignageData = async (database: Database, marketId: string, ownerUid: string, leaseId: string, data: SignageData, atMillis = Date.now()): Promise<boolean> => {
  const result = await runTransaction(ref(database, root(marketId)), (raw: LiveMarketState | null) => {
    if (!raw || !ownsLiveLease(raw, ownerUid, leaseId, atMillis)) return
    raw.signage = data
    return raw
  })
  return result.committed
}
