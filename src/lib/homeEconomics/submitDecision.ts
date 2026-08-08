import { httpsCallable, type Functions } from 'firebase/functions'

export interface SubmitHouseholdDecisionInput {
  lessonRunId: string
  householdId: string
  roundIndex: number
  /** assetType → yen delta the student wants to move into (positive) or out of (negative) that asset this round, funded from cash. */
  assetAllocationChangesYen: Record<string, number>
  insurancePurchaseIds: string[]
  insuranceCancelIds: string[]
  shortfallResolutionType: 'REDUCE_EXPENSES' | 'SELL_ASSETS' | 'BORROW' | 'PUBLIC_SUPPORT' | 'DELAY_GOAL' | null
  /** Required when shortfallResolutionType === 'SELL_ASSETS' — which asset is being sold. */
  shortfallResolutionAssetType?: string
  publicSupportApplicationIds: string[]
  idempotencyKey: string
  /** Spec §13.14: amount (yen) a RETIRED household voluntarily wants to draw down from its held assets this round, on top of normal cash flow. Optional; ignored server-side for non-retired households. */
  voluntaryDrawdownRequestedYen?: number
}

export interface SubmitHouseholdDecisionResult {
  decisionId: string
  created: boolean
}

/**
 * Client wrapper for `submitHouseholdDecisionCallable`. Deliberately does
 * NOT accept or send a `teamId` — the server resolves which team owns
 * `householdId` from the `HouseholdState` document itself and authorizes
 * against that, exactly like `submitOrder`'s client wrapper documents for
 * `teamId` but one step stricter: here the client cannot even attempt to
 * claim a team, matching `submitHouseholdDecisionCallable`'s own
 * "never trust a client-supplied ownership claim" authorization design.
 */
export const submitHouseholdDecision = async (
  functions: Functions, input: SubmitHouseholdDecisionInput,
): Promise<SubmitHouseholdDecisionResult> => {
  const callable = httpsCallable<SubmitHouseholdDecisionInput, SubmitHouseholdDecisionResult>(
    functions, 'submitHouseholdDecisionCallable',
  )
  const result = await callable(input)
  return result.data
}
