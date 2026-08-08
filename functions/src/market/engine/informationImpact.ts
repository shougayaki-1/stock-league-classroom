/**
 * PROVISIONAL — spec §12.7 defines `InformationImpact.shortTermImpact` /
 * `longTermImpact` as optional fields but gives no decay model or numeric
 * default for how many batches count as "short term" (統合仕様書に具体式
 * なし、試運転で調整する前提). This constant is the single place that
 * value lives; tuning after playtesting should only ever touch this
 * constant, same convention as priceCalculation.ts's
 * PRICE_SENSITIVITY_PRESETS / DEFAULT_NOISE_MAGNITUDE_PERCENT.
 */
export const SHORT_TERM_WINDOW_BATCHES = 10

export interface InformationImpactWindowInput {
  baseDirection: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL'
  strength: number
  shortTermImpact?: number
  longTermImpact?: number
  /** Number of batches elapsed since this item's publishedAtMillis, as of
   * the batch currently being settled. 0 means "this is the batch the
   * item was published in." */
  batchesSincePublication: number
}

const directionSign = (direction: InformationImpactWindowInput['baseDirection']): number => {
  if (direction === 'POSITIVE') return 1
  if (direction === 'NEGATIVE') return -1
  // MIXED and NEUTRAL both carry no clear net directional pressure at
  // this minimal-implementation stage — spec §12.6 explicitly rejects a
  // fixed "good news always moves price up" mapping, and no formula for
  // resolving MIXED into a signed contribution exists in the spec.
  return 0
}

/**
 * Minimal decay model for one information item's contribution to a
 * stock's `informationImpactPercent` (spec §12.20's `informationImpactPercent`
 * term). From publication through `SHORT_TERM_WINDOW_BATCHES` batches,
 * uses `shortTermImpact`; afterward, `longTermImpact`. Falls back to
 * `strength` when the term-specific value isn't set, so items authored
 * without shortTermImpact/longTermImpact still contribute a stable value.
 */
export const informationImpactPercent = (input: InformationImpactWindowInput): number => {
  const magnitude = input.batchesSincePublication < SHORT_TERM_WINDOW_BATCHES
    ? input.shortTermImpact ?? input.strength
    : input.longTermImpact ?? input.strength
  return directionSign(input.baseDirection) * magnitude
}
