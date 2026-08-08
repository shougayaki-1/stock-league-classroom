export interface SimplifiedPensionInput {
  preRetirementIncomeYen: number
  /** PROVISIONAL — spec §13.14 requires only "年金等の簡略給付" without a specified default rate; a value to tune during pilot runs (see Task 17). */
  pensionReplacementRatePercent: number
}

export const computeSimplifiedPensionBenefit = (input: SimplifiedPensionInput): number =>
  Math.round(input.preRetirementIncomeYen * (input.pensionReplacementRatePercent / 100))

export interface VoluntaryDrawdownInput {
  requestedYen: number
  assetHoldingsYen: Record<string, number>
}
export interface VoluntaryDrawdownResult {
  withdrawnYen: number
  newAssetHoldingsYen: Record<string, number>
}

/**
 * Spec §13.14: proportional across all held asset types by current
 * weight — never drains one asset type to zero while leaving another
 * untouched, which would silently undermine the diversification the
 * student built up (evaluated in Task 16, spec §13.17).
 */
export const computeVoluntaryAssetDrawdown = (input: VoluntaryDrawdownInput): VoluntaryDrawdownResult => {
  const totalHeldYen = Object.values(input.assetHoldingsYen).reduce((sum, v) => sum + v, 0)
  const withdrawnYen = Math.min(input.requestedYen, totalHeldYen)
  const newAssetHoldingsYen: Record<string, number> = {}
  for (const [assetType, heldYen] of Object.entries(input.assetHoldingsYen)) {
    const share = totalHeldYen === 0 ? 0 : heldYen / totalHeldYen
    newAssetHoldingsYen[assetType] = Math.round(heldYen - withdrawnYen * share)
  }
  return { withdrawnYen, newAssetHoldingsYen }
}
