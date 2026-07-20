/** All active-market state remains under liveMarkets/{marketId}; no global live collections. */
export interface LiveMarketMetadata { ownerUid: string; status: 'SETUP' | 'OPEN' | 'ENDING' | 'ENDED'; createdAtMillis: number }
export interface LiveMarketParticipant { uid: string; displayName: string; teamId: string | null; connected: boolean; lastSeenAtMillis: number }
export interface LiveMarketPaths { market: `liveMarkets/${string}`; participant: `liveMarkets/${string}/participants/${string}`; order: `liveMarkets/${string}/orders/${string}`; }
export const liveMarketPaths = (marketId: string, uid: string, orderId = 'pending'): LiveMarketPaths => ({ market: `liveMarkets/${marketId}`, participant: `liveMarkets/${marketId}/participants/${uid}`, order: `liveMarkets/${marketId}/orders/${orderId}` })
