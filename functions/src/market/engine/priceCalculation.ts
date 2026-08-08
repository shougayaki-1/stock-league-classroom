import { deriveSeed, mulberry32 } from '@stock-league/deterministic-random'
import type { PriceGuard } from '@stock-league/market-authoring-content'
import type { CompanySizeClass } from '@stock-league/market-public-content'

export const applyPriceGuard = (
  price: number,
  guard: PriceGuard,
  initialPrice: number,
): { price: number; guardApplied: boolean } => {
  const minimum = guard.type === 'ABSOLUTE'
    ? guard.minimumPrice
    : initialPrice * (guard.minimumPercent / 100)
  if (price < minimum) return { price: minimum, guardApplied: true }
  return { price, guardApplied: false }
}

export type PriceSensitivityPreset = 'INFO_FOCUSED' | 'BALANCED' | 'DEMAND_FOCUSED'

/**
 * Relative weight applied to the information term vs. the demand term.
 *
 * PROVISIONAL — this is one of the single-source constants this task
 * concentrates all "試運転で決める" (decide during playtesting) values
 * into, per the Phase C plan's Global Constraints and Task 19's
 * requirement to list PROVISIONAL constants. The spec resolution doc lists
 * "需給感度の既定値" as an unresolved default. Do not scatter these
 * multipliers elsewhere — tuning after playtesting should only ever touch
 * this constant.
 */
export const PRICE_SENSITIVITY_PRESETS: Record<PriceSensitivityPreset, { informationWeight: number; demandWeight: number }> = {
  INFO_FOCUSED: { informationWeight: 1.5, demandWeight: 0.5 },
  BALANCED: { informationWeight: 1, demandWeight: 1 },
  DEMAND_FOCUSED: { informationWeight: 0.5, demandWeight: 1.5 },
}

/**
 * PROVISIONAL — same reason as PRICE_SENSITIVITY_PRESETS above
 * ("市場ノイズの実値"; spec §12.22 gives only a qualitative ±0.2〜0.5%
 * guideline, no fixed default).
 */
export const DEFAULT_NOISE_MAGNITUDE_PERCENT = 0.35

/**
 * PROVISIONAL — no default for the §12.24 "急変" warning threshold exists
 * anywhere in the spec or the resolution doc; this value is introduced by
 * this task and is expected to be tuned during playtesting.
 */
export const DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT = 7

export interface PriceCalculationInput {
  currentPrice: number
  initialPrice: number
  /** Pre-aggregated across all information items active this batch. */
  informationImpactPercent: number
  /** Net (post-netting) demand value in yen — spec resolution C. */
  netDemandValue: number
  effectiveMarketSize: number
  demandSensitivity: number
  priceSensitivityPreset: PriceSensitivityPreset
  noiseEnabled: boolean
  randomSeed: string
  restoreGeneration: number
  stockId: string
  batchIndex: number
  priceGuard: PriceGuard
  noiseMagnitudePercent?: number
  suddenChangeWarningThresholdPercent?: number
}

export interface PriceCalculationResult {
  nextPrice: number
  guardApplied: boolean
  suddenChangeWarning: boolean
  breakdown: {
    informationPercent: number
    demandPercent: number
    /**
     * Displayed to students as "その他要因" per spec §12.31 — never
     * labeled "noise" or "market noise" in student-facing copy.
     */
    otherPercent: number
    total: number
  }
}

export const calculateNextPrice = (input: PriceCalculationInput): PriceCalculationResult => {
  const weights = PRICE_SENSITIVITY_PRESETS[input.priceSensitivityPreset]
  const demandRatio = input.netDemandValue / input.effectiveMarketSize
  const demandPercent = demandRatio * input.demandSensitivity * weights.demandWeight * 100
  const informationPercent = input.informationImpactPercent * weights.informationWeight

  let otherPercent = 0
  if (input.noiseEnabled) {
    const magnitude = input.noiseMagnitudePercent ?? DEFAULT_NOISE_MAGNITUDE_PERCENT
    // Fixed seed schema per the Phase C plan's Global Constraints:
    // derive(`${randomSeed}:${restoreGeneration}:${stockId}:${batchIndex}`)
    const seed = deriveSeed([input.randomSeed, input.restoreGeneration, input.stockId, input.batchIndex])
    const rand = mulberry32(seed)()
    // rand is in [0, 1) — map to [-magnitude, +magnitude]
    otherPercent = (rand * 2 - 1) * magnitude
  }

  const total = informationPercent + demandPercent + otherPercent
  const rawNextPrice = input.currentPrice * (1 + total / 100)
  const guardResult = applyPriceGuard(Math.round(rawNextPrice), input.priceGuard, input.initialPrice)
  const threshold = input.suddenChangeWarningThresholdPercent ?? DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT

  return {
    nextPrice: guardResult.price,
    guardApplied: guardResult.guardApplied,
    suddenChangeWarning: Math.abs(total) >= threshold,
    breakdown: { informationPercent, demandPercent, otherPercent, total },
  }
}

/**
 * PROVISIONAL — spec resolution doc lists no numeric default for company
 * size → market size (only "小さい企業: 動きやすい" as qualitative
 * guidance). These values are a starting point for playtesting, kept in
 * one place per this plan's Global Constraints. Units are yen — a
 * netDemandValue equal to this size moves the price by `demandSensitivity`
 * × 100%, per calculateNextPrice's demandRatio calculation.
 */
export const SIZE_CLASS_TO_EFFECTIVE_MARKET_SIZE: Record<CompanySizeClass, number> = {
  SMALL: 50000,
  MEDIUM: 150000,
  LARGE: 400000,
}

export const effectiveMarketSizeForCompany = (sizeClass: CompanySizeClass): number =>
  SIZE_CLASS_TO_EFFECTIVE_MARKET_SIZE[sizeClass]
