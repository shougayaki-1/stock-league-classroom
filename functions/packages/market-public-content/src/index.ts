/**
 * Student-facing view of a company/information item/indicator. This
 * package is imported by both the client (`src/`, student-facing UI) and
 * Functions (`functions/`, which populates RTDB `lessonRunPublic` from
 * this shape) — the same workspace pattern as
 * `@stock-league/deterministic-random`. It must NEVER gain a field that
 * reveals impactSensitivities, minimumPriceGuard internals, or any other
 * non-public coefficient — those live in
 * `@stock-league/market-authoring-content` instead, which the teacher's
 * authoring UI legitimately imports but which this package must never
 * import (the dependency points one way: authoring-content may reference
 * this package's shared enums, never the reverse). Spec §12.4's difficulty
 * tiers (初級/標準/発展) are expressed by which of the optional fields
 * below are populated, not by a separate type.
 */
export type CompanySizeClass = 'SMALL' | 'MEDIUM' | 'LARGE'
export type CompanyDifficultyTier = 'BASIC' | 'STANDARD' | 'ADVANCED'

export interface CompanyPublicView {
  id: string
  name: string
  symbol: string
  industry: string
  description: string
  productsAndServices: string[]
  sizeClass: CompanySizeClass
  riskFactors: string[]
  // STANDARD tier and above
  domesticRevenueRatio?: number
  overseasRevenueRatio?: number
  costDrivers?: string[]
  growthProfile?: 'STABLE' | 'GROWTH' | 'CYCLICAL'
  // ADVANCED tier only
  financialStrength?: 'WEAK' | 'STANDARD' | 'STRONG'
}

export type InformationCategory =
  | 'OFFICIAL_NEWS' | 'MARKET_DATA' | 'EARNINGS' | 'ANALYSIS' | 'UNVERIFIED'
export type InformationNature = 'FACT' | 'FORECAST' | 'OPINION'
export type InformationConfidence = 'HIGH' | 'MEDIUM' | 'UNKNOWN'

export interface InformationPublicView {
  id: string
  category: InformationCategory
  source: string
  publishedAtMillis: number
  natureType: InformationNature
  confidenceLevel: InformationConfidence
  targetCompanyIds: string[]
  body: string
}

export type EconomicIndicatorKind = 'ECONOMY' | 'PRICE' | 'INTEREST_RATE' | 'FX' | 'POLICY'
export type EconomicIndicatorDifficultyTier = 'BASIC' | 'STANDARD' | 'ADVANCED'

export interface EconomicIndicatorPublicView {
  id: string
  kind: EconomicIndicatorKind
  publishedAtMillis: number
  // BASIC: only a plain-language label (e.g. "円安", "利上げ")
  label: string
  // STANDARD and above: the numeric value/change
  value?: number
  changeFromPrevious?: number
}
