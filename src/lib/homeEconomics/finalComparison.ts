import { httpsCallable, type Functions } from 'firebase/functions'

export interface ShowHouseholdComparisonOnDisplayInput {
  lessonRunId: string
}

/**
 * Client wrapper for `showHouseholdComparisonOnDisplayCallable`
 * (`functions/src/homeEconomics/onCall.ts`). Deliberately accepts and sends
 * ONLY `lessonRunId` — never a comparison payload — matching that
 * Callable's own security-critical constraint of always reading the safe
 * `HouseholdClassComparisonPublicView` snapshot back from Firestore
 * server-side rather than trusting anything the client supplies. See that
 * Callable's JSDoc for the full auth/race-condition design.
 */
export const showHouseholdComparisonOnDisplay = async (
  functions: Functions, input: ShowHouseholdComparisonOnDisplayInput,
): Promise<void> => {
  const callable = httpsCallable<ShowHouseholdComparisonOnDisplayInput, void>(
    functions, 'showHouseholdComparisonOnDisplayCallable',
  )
  await callable(input)
}
