import type { SignageData } from './liveMarketTypes'

const marketStatuses = ['SETUP', 'OPEN', 'PAUSED', 'ENDING', 'ENDED'] as const

/** Old projections may not have every collection yet. Normalize them before
 * rendering so one incomplete snapshot cannot crash the classroom screen. */
export const normalizeSignageData = (value: unknown): SignageData | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.joinCode !== 'string' || !marketStatuses.includes(raw.phase as typeof marketStatuses[number])) return undefined
  const prices = Array.isArray(raw.prices) ? raw.prices.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    return typeof entry.stockId === 'string' && typeof entry.stockName === 'string' && typeof entry.price === 'number'
      ? [{ stockId: entry.stockId, stockName: entry.stockName, price: entry.price }]
      : []
  }) : []
  const publicNews = Array.isArray(raw.publicNews) ? raw.publicNews.filter((item): item is string => typeof item === 'string') : []
  const leaderboard = Array.isArray(raw.leaderboard) ? raw.leaderboard.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    return typeof entry.name === 'string' && typeof entry.valuation === 'number' && typeof entry.rank === 'number'
      ? [{ name: entry.name, valuation: entry.valuation, rank: entry.rank }]
      : []
  }) : []
  return { joinCode: raw.joinCode, prices, publicNews, phase: raw.phase as SignageData['phase'], leaderboard }
}
