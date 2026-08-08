export interface DetectShortfallInput {
  cashSavingsYen: number
  netCashFlowYen: number
}

/** Spec §13.13: a shortfall exists only when this round's cash flow would drive savings below 0. Returns the exact positive shortfall, or 0 when covered. */
export const detectShortfall = (input: DetectShortfallInput): number => {
  const projectedCashYen = input.cashSavingsYen + input.netCashFlowYen
  return projectedCashYen < 0 ? -projectedCashYen : 0
}

export type ShortfallOptionType = 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL'
export interface ShortfallOption {
  type: ShortfallOptionType
  description: string
  resolvesYen: number
}

export interface BuildShortfallOptionsInput {
  shortfallYen: number
  liquidAssetsYen: number
  /** Task 9's output — 0 when the household doesn't qualify this round. */
  publicSupportAvailableYen: number
  /** From `HomeEconomicsContent` (Task 2) — whether the template permits emergency borrowing at all. */
  borrowingAllowed: boolean
}

/**
 * Spec §13.13: never auto-bankrupts — REDUCE_EXPENSES and DELAY_GOAL are
 * always offered regardless of assets/permissions (a student can always
 * choose to cut spending or push the goal back). The other three only
 * appear when actually possible, so the UI never offers a resolution path
 * that would fail.
 */
export const buildShortfallOptions = (input: BuildShortfallOptionsInput): ShortfallOption[] => {
  const options: ShortfallOption[] = [
    { type: 'REDUCE_EXPENSES', description: '生活費を切り詰める', resolvesYen: input.shortfallYen },
    { type: 'DELAY_GOAL', description: '目標達成を先送りする', resolvesYen: input.shortfallYen },
  ]
  if (input.liquidAssetsYen > 0) {
    options.push({ type: 'SELL_ASSETS', description: '資産を売却する', resolvesYen: Math.min(input.shortfallYen, input.liquidAssetsYen) })
  }
  if (input.borrowingAllowed) {
    options.push({ type: 'BORROW', description: '借入をする', resolvesYen: input.shortfallYen })
  }
  if (input.publicSupportAvailableYen > 0) {
    options.push({ type: 'PUBLIC_SUPPORT', description: '公的支援を申請する', resolvesYen: Math.min(input.shortfallYen, input.publicSupportAvailableYen) })
  }
  return options
}

export interface ShortfallResolutionResult {
  cashDeltaYen: number
  assetDeltaYen: number
  newLiabilityYen: number
  goalDelayedRounds: number
}

/**
 * BORROW always covers the FULL shortfall (a loan sized to need, not
 * capped by the option's own `resolvesYen`) — unlike SELL_ASSETS/
 * PUBLIC_SUPPORT, which are capped by what's actually available.
 */
export const applyShortfallResolution = (option: ShortfallOption, shortfallYen: number): ShortfallResolutionResult => {
  switch (option.type) {
    case 'SELL_ASSETS':
      return { cashDeltaYen: option.resolvesYen, assetDeltaYen: -option.resolvesYen, newLiabilityYen: 0, goalDelayedRounds: 0 }
    case 'PUBLIC_SUPPORT':
      return { cashDeltaYen: option.resolvesYen, assetDeltaYen: 0, newLiabilityYen: 0, goalDelayedRounds: 0 }
    case 'BORROW':
      return { cashDeltaYen: shortfallYen, assetDeltaYen: 0, newLiabilityYen: shortfallYen, goalDelayedRounds: 0 }
    case 'REDUCE_EXPENSES':
      return { cashDeltaYen: option.resolvesYen, assetDeltaYen: 0, newLiabilityYen: 0, goalDelayedRounds: 0 }
    case 'DELAY_GOAL':
      return { cashDeltaYen: 0, assetDeltaYen: 0, newLiabilityYen: 0, goalDelayedRounds: 1 }
  }
}
