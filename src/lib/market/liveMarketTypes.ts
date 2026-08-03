/** All mutable market state lives below liveMarkets/{marketId}. */
export type MarketStatus = 'SETUP' | 'OPEN' | 'ENDING' | 'ENDED'
export type MarketVisibility = 'private' | 'ranking_only' | 'public'
export type TeamAssignmentMode = 'manual' | 'student_choice' | 'random'

export interface LiveMarketMetadata {
  ownerUid: string
  capacity: number
  visibility: MarketVisibility
  status: MarketStatus
  createdAtMillis: number
  startingCash: number
  joinCode: string
  openedAtMillis?: number
}

export interface LiveMarketTeam { id: string; name: string }
export interface JoinRequest {
  uid: string; sessionId: string; displayName: string; requestedTeamId: string | null
  connected: boolean; requestedAtMillis: number; approvedAtMillis?: number
  /** Issued on approval; lets the same student return from another device. */
  recoveryCode?: string
}
/** Reverse index from a student-facing recovery code to the live participant it restores. */
export interface RecoveryEntry { participantId: string; teamId: string; displayName: string }
export interface LiveMarketParticipant {
  uid: string; sessionId: string; displayName: string; teamId: string | null
  connected: boolean; lastSeenAtMillis: number
}
export interface HostLease { ownerUid: string; leaseId: string; expiresAtMillis: number; paused?: boolean }
export interface LivePrice { price: number; updatedAtMillis: number; runtime?: import('../pricing/types').PriceRuntimeState }
export interface PendingOrder { orderId: string; stockId: string; side: 'BUY' | 'SELL'; quantity: number; submittedAtMillis: number }
export interface Portfolio { cash: number; holdings: Record<string, number>; updatedAtMillis: number }
export interface OrderResult {
  orderId: string
  participantId: string
  teamId: string
  stockId: string
  side: 'BUY' | 'SELL'
  requestedQuantity: number
  filledQuantity: number
  price: number
  processedAtMillis: number
}
export interface MarketMember { teamId: string }
export interface TeamLeaderboardEntry { teamId: string; name: string; valuation: number; rank: number }
/** Host-authored projection exposed to classroom signage; never contains raw portfolios. */
export interface SignageData {
  joinCode: string
  prices: { stockId: string; stockName: string; price: number }[]
  publicNews: string[]
  phase: MarketStatus
  leaderboard: { name: string; valuation: number; rank: number }[]
}
export interface LiveMarketState {
  meta: LiveMarketMetadata
  teams: Record<string, LiveMarketTeam>
  companies?: Record<string, { id: string; name: string; symbol: string; basePrice: number; phases?: import('../pricing/types').StockPricePhase[] }>
  members?: Record<string, MarketMember>
  joinRequests?: Record<string, JoinRequest>
  recoveryCodes?: Record<string, RecoveryEntry>
  participants?: Record<string, LiveMarketParticipant>
  hostLease?: HostLease
  hostDisconnects?: Record<string, { ownerUid: string; disconnectedAtMillis: number }>
  prices?: Record<string, LivePrice>
  orders?: Record<string, { pending?: PendingOrder }>
  teamPortfolios?: Record<string, Portfolio>
  transactions?: Record<string, Record<string, OrderResult>>
  teamLeaderboard?: Record<string, TeamLeaderboardEntry>
  news?: Record<string, { message: string; publishedAtMillis: number; impactPercent?: number }>
  finalization?: { status: 'PENDING' | 'WRITING_RESULTS' | 'COMPLETED'; checkpointId: string; startedAtMillis: number; completedAtMillis?: number }
  /** Host-authored, pre-aggregated projection for the physical signage display. Never raw portfolios. */
  signage?: SignageData
}
export interface LiveMarketPaths {
  market: `liveMarkets/${string}`
  participant: `liveMarkets/${string}/participants/${string}`
  order: `liveMarkets/${string}/orders/${string}`
}
export const participantId = (uid: string, sessionId: string) => `${uid}_${sessionId}`
export const liveMarketPaths = (marketId: string, id: string, orderId = 'pending'): LiveMarketPaths => ({
  market: `liveMarkets/${marketId}`,
  participant: `liveMarkets/${marketId}/participants/${id}`,
  order: `liveMarkets/${marketId}/orders/${orderId}`,
})
