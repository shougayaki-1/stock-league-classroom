export type MarketplaceVisibility = 'COMMUNITY' | 'VERIFIED' | 'OFFICIAL'

export const MARKETPLACE_VISIBILITIES: readonly MarketplaceVisibility[] = [
  'COMMUNITY',
  'VERIFIED',
  'OFFICIAL',
]

export const isMarketplaceVisibility = (value: unknown): value is MarketplaceVisibility =>
  value === 'COMMUNITY' || value === 'VERIFIED' || value === 'OFFICIAL'
