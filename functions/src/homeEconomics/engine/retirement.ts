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
  const entries = Object.entries(input.assetHoldingsYen)
  const totalHeldYen = entries.reduce((sum, [, v]) => sum + v, 0)
  const withdrawnYen = Math.min(input.requestedYen, totalHeldYen)

  // Largest-remainder (apportionment) method: guarantees exact sum
  // conservation AND that no entry ever goes negative. "Last entry
  // absorbs the residual" was tried before this and conserved the sum
  // but could push the last entry below zero when its own floor share
  // was smaller than the accumulated rounding residual.
  const shares = entries.map(([assetType, heldYen]) => {
    const exactWithdrawal = totalHeldYen === 0 ? 0 : (withdrawnYen * heldYen) / totalHeldYen
    const floorWithdrawal = Math.floor(exactWithdrawal)
    return {
      assetType,
      heldYen,
      floorWithdrawal,
      fractionalPart: exactWithdrawal - floorWithdrawal,
    }
  })

  // Every floorWithdrawal <= heldYen here: exactWithdrawal = withdrawnYen *
  // heldYen / totalHeldYen <= heldYen because withdrawnYen <= totalHeldYen
  // (guaranteed by the Math.min cap above), so flooring only shrinks it
  // further. Each entry therefore has non-negative headroom before any
  // remainder is distributed.
  let remainder = withdrawnYen - shares.reduce((sum, s) => sum + s.floorWithdrawal, 0)

  const byFractionalPartDesc = [...shares].sort((a, b) => b.fractionalPart - a.fractionalPart)
  const extraWithdrawal = new Map<string, number>()
  for (const share of byFractionalPartDesc) {
    if (remainder <= 0) break
    const headroom = share.heldYen - share.floorWithdrawal
    if (headroom <= 0) continue // this asset type is already fully depleted by its floor share
    extraWithdrawal.set(share.assetType, 1)
    remainder -= 1
  }
  // remainder should always reach 0: sum(floorWithdrawal) = withdrawnYen -
  // remainder < withdrawnYen <= totalHeldYen = sum(heldYen), so combined
  // headroom across all entries always covers the remainder.

  const newAssetHoldingsYen: Record<string, number> = {}
  for (const share of shares) {
    const extra = extraWithdrawal.get(share.assetType) ?? 0
    newAssetHoldingsYen[share.assetType] = share.heldYen - share.floorWithdrawal - extra
  }

  return { withdrawnYen, newAssetHoldingsYen }
}
