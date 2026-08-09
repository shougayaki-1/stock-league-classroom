import { httpsCallable, type Functions } from 'firebase/functions'

export interface ProcessRoundInput {
  lessonRunId: string
  householdId: string
  /** Teacher-facing escape hatch — see `processRoundCallable`'s own doc comment (functions/src/homeEconomics/onCall.ts). Omitted/false means settling is rejected unless the household has a submitted decision on record. */
  forceSettle?: boolean
}

export interface ProcessRoundResult {
  newHouseholdState: {
    householdId: string
    lessonRunId: string
    teamId: string
    cashYen: number
    assetHoldingsYen: Record<string, number>
    activeInsuranceContracts: Record<string, number>
    activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number; annualInterestRatePercent: number }>
    lifeStage: string
    roundIndex: number
    goalDelayedRounds: number
    updatedAtServerMillis: number
  }
  occurredEventIds: string[]
  incomeYen: number
  expensesYen: number
  netCashFlowYen: number
  shortfallYen: number
  insuranceBenefitsYen: number
}

/**
 * Client wrapper for `processRoundCallable` (functions/src/homeEconomics/onCall.ts),
 * matching `src/lib/homeEconomics/submitDecision.ts`'s existing thin-wrapper
 * style. Teacher-facing, PRIMARY-role only — settles one household's round
 * at a time (this Callable's own scope), so a caller that needs to settle
 * every household in a lessonRun invokes this once per householdId.
 */
export const processRound = async (
  functions: Functions, input: ProcessRoundInput,
): Promise<ProcessRoundResult> => {
  const callable = httpsCallable<ProcessRoundInput, ProcessRoundResult>(functions, 'processRoundCallable')
  const result = await callable(input)
  return result.data
}
