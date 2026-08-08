/**
 * Teacher-authoring / server-internal types. This package IS imported by
 * `src/` (the teacher's own authoring UI legitimately edits
 * impactSensitivities, InformationImpact, etc. — the teacher is the
 * author of these values). What must never happen is a STUDENT receiving
 * this data — that is enforced by Firestore rules on
 * `lessonRuns`/`lessonTemplates` (teacher read-only) and by
 * `functions/src/market/toPublicView.ts` being the only producer of what
 * lands in the student-readable RTDB `lessonRunPublic` path, not by
 * restricting who may import this type. This file depends on
 * `@stock-league/market-public-content` for shared enum types
 * (`CompanySizeClass` etc.) — the dependency points one way: this package
 * may reference that one, never the reverse.
 */
import type { CompanySizeClass, InformationCategory, InformationConfidence, InformationNature } from '@stock-league/market-public-content'

export type PriceGuard =
  | { type: 'ABSOLUTE'; minimumPrice: number }
  | { type: 'PERCENT_OF_INITIAL'; minimumPercent: number }

export interface SimulatedCompany {
  id: string
  name: string
  symbol: string
  industry: string
  description: string
  productsAndServices: string[]
  domesticRevenueRatio?: number
  overseasRevenueRatio?: number
  costDrivers: string[]
  sizeClass: CompanySizeClass
  financialStrength: 'WEAK' | 'STANDARD' | 'STRONG'
  growthProfile: 'STABLE' | 'GROWTH' | 'CYCLICAL'
  riskFactors: string[]
  initialPrice: number
  minimumPriceGuard: PriceGuard
  /** Hidden. Never sent to students. Keyed by InformationCategory. */
  impactSensitivities: Record<string, number>
}

export interface InformationImpact {
  baseDirection: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL'
  strength: number
  marketExpectation?: number
  interactions?: string[]
  shortTermImpact?: number
  longTermImpact?: number
}

export interface InformationItem {
  id: string
  category: InformationCategory
  source: string
  publishedAtMillis: number
  natureType: InformationNature
  confidenceLevel: InformationConfidence
  targetCompanyIds: string[]
  /** Student-visible body. Everything else on this type is teacher-only. */
  body: string
  /** Hidden. Drives priceCalculation.ts (Task 3). Never sent to students. */
  impact: InformationImpact
}

export interface EconomicIndicatorAuthoring {
  id: string
  kind: 'ECONOMY' | 'PRICE' | 'INTEREST_RATE' | 'FX' | 'POLICY'
  publishedAtMillis: number
  label: string
  value?: number
  changeFromPrevious?: number
  /** Hidden. Per-company multiplier — spec §12.8 "企業特性と結び付ける". */
  companyImpactMultipliers: Record<string, number>
}

export type PredictionEvaluationTarget =
  | { type: 'AFTER_BATCHES'; count: number }
  | { type: 'NEXT_INFORMATION' }
  | { type: 'MARKET_CLOSE' }

export interface SocialStudiesEvaluationWeights {
  operationResult: number
  predictionAccuracy: number
  informationUsage: number
  riskManagement: number
  reflection: number
}

/**
 * All §28 default-value-table entries relevant to the market live here as
 * field defaults, not scattered across engine code (spec §30-10). Values
 * ARE the authoring type's field values for a given LessonTemplate — there
 * is no separate "defaults config" file to keep in sync.
 *
 * Lives in this package (not `src/lib/lessonTemplates/types.ts`, where
 * `LessonContent.socialStudiesMarket` references it) so that both the
 * client-side authoring UI (`src/`) and server-side validation
 * (`functions/src/market/templateValidation.ts`) import the same
 * definition from a workspace package — `functions/` cannot import across
 * the repo root into `src/` (breaks `tsc`'s `rootDir` and the Cloud
 * Functions deploy bundle, which only includes `functions/`).
 */
export interface SocialStudiesMarketContent {
  companies: SimulatedCompany[]
  informationItems: InformationItem[]
  economicIndicators: EconomicIndicatorAuthoring[]
  /** §12.9. Default 3, teacher range 1-10. */
  batchIntervalSeconds: number
  /** §12.20 abstract control shown to teachers instead of raw coefficients. */
  priceSensitivityPreset: 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'
  /** §12.22. Default true (small noise). BASIC tier may disable. */
  marketNoiseEnabled: boolean
  /** §12.26. Default 30. */
  resumeConfirmationSeconds: number
  companyDifficultyTier: 'BASIC' | 'STANDARD' | 'ADVANCED'
  indicatorDifficultyTier: 'BASIC' | 'STANDARD' | 'ADVANCED'
  /** §12.28. Default 0. */
  tradingFeeYen: number
  /** §12.28/§12.29. All default false — see Task 17. */
  dividendEnabled: boolean
  stockSplitEnabled: boolean
  bankruptcyEnabled: boolean
  /**
   * §12.29. Batch indexes at which a dividend fires, when `dividendEnabled`
   * is true. Default `[]` (never fires). Deliberately a separate array
   * from `stockSplitTriggerBatchIndexes` rather than one shared
   * `triggerBatchIndexes` — sharing one array would make "fire dividend
   * only" inexpressible whenever a split is also scheduled somewhere in
   * the run, since both features would fire together on every listed
   * index. See Task 17.
   */
  dividendTriggerBatchIndexes: number[]
  /** §12.29. Batch indexes at which a stock split fires, when
   * `stockSplitEnabled` is true. Default `[]` (never fires). See
   * `dividendTriggerBatchIndexes` for why this is a separate array. */
  stockSplitTriggerBatchIndexes: number[]
  /** §12.29. Flat per-share dividend amount (yen), applied to every
   * company uniformly when a dividend fires. Default 0. */
  dividendPerShareYen: number
  /** §12.29. Flat split ratio (e.g. 2 for a 1:2 split), applied to every
   * company uniformly when a split fires. Default 1 (no-op). */
  stockSplitRatio: number
  /** §12.32/矛盾解消F. Default { type: 'AFTER_BATCHES', count: 20 } — see Task 15. */
  predictionEvaluationTarget: PredictionEvaluationTarget
  /** §12.33. Must sum to 1; validated by `validateSocialStudiesMarketContent`. */
  evaluationWeights: SocialStudiesEvaluationWeights
}
