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
}

export interface LiveMarketTeam { id: string; name: string }
export interface JoinRequest {
  uid: string; sessionId: string; displayName: string; requestedTeamId: string | null
  connected: boolean; requestedAtMillis: number; approvedAtMillis?: number
}
export interface LiveMarketParticipant {
  uid: string; sessionId: string; displayName: string; teamId: string | null
  connected: boolean; lastSeenAtMillis: number
}
export interface HostLease { ownerUid: string; leaseId: string; expiresAtMillis: number; paused?: boolean }
export interface LivePrice { price: number; updatedAtMillis: number; runtime?: import('../pricing/types').PriceRuntimeState }
export interface PendingOrder { orderId: string; stockId: string; side: 'BUY' | 'SELL'; quantity: number; submittedAtMillis: number }
export interface Portfolio { cash: number; holdings: Record<string, number>; updatedAtMillis: number }
export interface OrderResult { orderId: string; stockId: string; side: 'BUY' | 'SELL'; requestedQuantity: number; filledQuantity: number; price: number; processedAtMillis: number }
export interface LiveMarketState {
  meta: LiveMarketMetadata
  teams: Record<string, LiveMarketTeam>
  joinRequests?: Record<string, JoinRequest>
  participants?: Record<string, LiveMarketParticipant>
  hostLease?: HostLease
  hostDisconnects?: Record<string, { ownerUid: string; disconnectedAtMillis: number }>
  prices?: Record<string, LivePrice>
  orders?: Record<string, { pending?: PendingOrder }>
  portfolios?: Record<string, Portfolio>
  transactions?: Record<string, Record<string, OrderResult>>
  news?: Record<string, { message: string; publishedAtMillis: number }>
  finalization?: { status: 'PENDING' | 'WRITING_RESULTS' | 'COMPLETED'; checkpointId: string; startedAtMillis: number; completedAtMillis?: number }
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
