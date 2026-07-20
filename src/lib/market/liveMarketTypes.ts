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
export interface LiveMarketState {
  meta: LiveMarketMetadata
  teams: Record<string, LiveMarketTeam>
  joinRequests?: Record<string, JoinRequest>
  participants?: Record<string, LiveMarketParticipant>
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
