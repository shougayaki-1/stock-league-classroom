import type { MarketVisibility } from '../market/liveMarketTypes'

/**
 * Determines if a viewer can see another person's portfolio based on market visibility.
 * Always allows viewing own/teammate's portfolio.
 * Otherwise only allows viewing if market is public.
 */
export function canViewOtherPortfolio(
  visibility: MarketVisibility,
  viewerIsSelfOrTeammate: boolean
): boolean {
  if (viewerIsSelfOrTeammate) {
    return true
  }
  return visibility === 'public'
}

/**
 * Determines if a market restricts portfolio visibility to leaderboard rankings only.
 */
export function canViewLeaderboardOnly(visibility: MarketVisibility): boolean {
  return visibility === 'ranking_only'
}
