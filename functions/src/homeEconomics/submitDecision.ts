export interface HouseholdDecisionInput {
  lessonRunId: string
  householdId: string
  roundIndex: number
  /** assetType → yen delta the student wants to move into (positive) or out of (negative) that asset this round, funded from cash. */
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  /** Task 8's ShortfallOptionType, or null when there is no shortfall this round / the student hasn't resolved it yet. */
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  /** Required when shortfallResolutionType === 'SELL_ASSETS' — which asset is being sold. */
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
  /**
   * Spec §13.14: the amount (yen) a RETIRED household voluntarily wants to
   * draw down from its held assets this round, on top of normal cash flow
   * — a discretionary choice to raise living standards, not a
   * shortfall-driven forced sale (that remains `shortfallResolutionType:
   * 'SELL_ASSETS'`). Optional/omitted for non-retired households, where
   * `settleRound` ignores it entirely regardless of what a caller sends.
   */
  voluntaryDrawdownRequestedYen?: number
}
export interface SubmitHouseholdDecisionDeps {
  saveDecision: (input: HouseholdDecisionInput) => Promise<{ decisionId: string; created: boolean }>
}

/**
 * Spec §13.13: a shortfall resolved by selling asset X must not also be
 * offset by allocating MORE cash into asset X in the same submission —
 * that would let a student simultaneously "sell to cover the gap" and
 * "buy more of the same thing", netting to a free lunch. This is the one
 * cross-field consistency check that only makes sense once the whole
 * round's decision is assembled — the reason this Callable accepts the
 * decision as one bundle rather than N independent LessonResponse
 * submissions (see this task's own top-level rationale).
 */
export const submitHouseholdDecision = async (
  deps: SubmitHouseholdDecisionDeps & HouseholdDecisionInput,
): Promise<{ decisionId: string; created: boolean }> => {
  if (
    deps.shortfallResolutionType === 'SELL_ASSETS'
    && deps.shortfallResolutionAssetType !== undefined
    && (deps.assetAllocationChangesYen[deps.shortfallResolutionAssetType] ?? 0) > 0
  ) {
    throw new Error('資金不足の解消に使う資産へ、同時に追加配分することはできません。')
  }
  const { saveDecision, ...input } = deps
  return saveDecision(input)
}
