import type { HouseholdDecisionRecord } from '../lessonRuns/households/repository'

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
 *
 * Extracted as its own function (Task 5) so BOTH `submitHouseholdDecision`
 * (Common) and `submitAdvancedHouseholdDecision` (the 3 advanced formats,
 * below) run the exact same business-rule check rather than each Callable
 * branch re-implementing or accidentally diverging from it — the advanced
 * save path (`saveAdvancedHouseholdDecisionWithAdminSdk`,
 * `lessonRuns/households/repository.ts`) is a different persistence
 * function guarded by the `HouseholdRuntimeControl` document, but it must
 * never be a way to bypass this field-level validation.
 */
const validateShortfallSellAssetsConsistency = (input: {
  shortfallResolutionType: HouseholdDecisionInput['shortfallResolutionType']
  shortfallResolutionAssetType?: string
  assetAllocationChangesYen: Record<string, number>
}): void => {
  if (
    input.shortfallResolutionType === 'SELL_ASSETS'
    && input.shortfallResolutionAssetType !== undefined
    && (input.assetAllocationChangesYen[input.shortfallResolutionAssetType] ?? 0) > 0
  ) {
    throw new Error('資金不足の解消に使う資産へ、同時に追加配分することはできません。')
  }
}

export const submitHouseholdDecision = async (
  deps: SubmitHouseholdDecisionDeps & HouseholdDecisionInput,
): Promise<{ decisionId: string; created: boolean }> => {
  validateShortfallSellAssetsConsistency(deps)
  const { saveDecision, ...input } = deps
  return saveDecision(input)
}

/**
 * Advanced-format (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) decision
 * input — the fully-assembled `HouseholdDecisionRecord` fields (minus the
 * server-stamped `submittedAtServerMillis`) plus the two `HouseholdRuntimeControl`
 * consistency values `saveAdvancedHouseholdDecisionWithAdminSdk`
 * (`lessonRuns/households/repository.ts`) requires. This mirrors that
 * repository function's own input shape exactly, since `saveDecision` below
 * is expected to be wired directly to it (same DI-callback composition
 * `submitHouseholdDecision`/`saveHouseholdDecision` already establish for
 * Common).
 */
export interface SubmitAdvancedHouseholdDecisionInput {
  lessonRunId: string
  householdId: string
  decision: Omit<HouseholdDecisionRecord, 'submittedAtServerMillis'>
  expectedSynchronizedRoundIndex: number
  assignmentRevision: number
  idempotencyKey: string
  nowMillis: number
}

export interface SubmitAdvancedHouseholdDecisionDeps {
  saveDecision: (input: SubmitAdvancedHouseholdDecisionInput) => Promise<HouseholdDecisionRecord>
}

/**
 * Advanced-format counterpart to `submitHouseholdDecision` above. Runs the
 * exact same §13.13 cross-field validation
 * (`validateShortfallSellAssetsConsistency`) before delegating to
 * `saveDecision` — preserving current decision field validation for the
 * advanced course formats too, not just Common.
 */
export const submitAdvancedHouseholdDecision = async (
  deps: SubmitAdvancedHouseholdDecisionDeps & SubmitAdvancedHouseholdDecisionInput,
): Promise<HouseholdDecisionRecord> => {
  validateShortfallSellAssetsConsistency({
    shortfallResolutionType: deps.decision.shortfallResolutionType,
    shortfallResolutionAssetType: deps.decision.shortfallResolutionAssetType,
    assetAllocationChangesYen: deps.decision.assetAllocationChangesYen,
  })
  const { saveDecision, ...input } = deps
  return saveDecision(input)
}
