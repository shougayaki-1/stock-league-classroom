import type { HouseholdState } from '../lessonRuns/households/repository'
import type { ConceptCategory } from './goalPackage'
import type { EventDisclosureView } from './engine/lifeEvents'
import type { ShortfallOption } from './engine/shortfallOptions'

/**
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * `HouseholdStateTeamView` — functions cannot import across the
 * functions/src rootDir boundary (see functions/src/lessonRuns/
 * projections/publicProjection.ts's established precedent). Keep both in
 * sync by hand.
 */
export interface HouseholdStateTeamView {
  householdId: string
  isFictional: true
  cashYen: number
  assetHoldingsYen: Record<string, number>
  /** insuranceProductId → years remaining — allow-list, never the product's internalClaimProbability. */
  activeInsuranceContractYearsRemaining: Record<string, number>
  /** liabilityId → remaining principal/years — never the origination principal or a resolved catalog entry. */
  activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number }>
  lifeStage: string
  roundIndex: number
  goalDelayedRounds: number
  visibleConcepts: ConceptCategory[]
  eventDisclosures: EventDisclosureView[]
  shortfallOptions: ShortfallOption[]
}

/**
 * Projects one household's `HouseholdState` (Task 10) plus this round's
 * derived views (Task 7/8/14) down to the team-broadcast-safe shape for
 * `lessonRunTeamState/{lessonRunId}/{teamId}`. Allow-list only — never
 * `{...household}` — so a future field added to `HouseholdState` is
 * excluded by default. Caller MUST pass exactly one household's own
 * `HouseholdState`; this function has no team-membership check of its own
 * (same discipline as Phase C's `toMyOrdersView`, Task 20).
 */
export const toHouseholdStateTeamView = (
  household: HouseholdState,
  visibleConcepts: ConceptCategory[],
  eventDisclosures: EventDisclosureView[],
  shortfallOptions: ShortfallOption[],
): HouseholdStateTeamView => ({
  householdId: household.householdId,
  isFictional: true,
  cashYen: household.cashYen,
  assetHoldingsYen: { ...household.assetHoldingsYen },
  activeInsuranceContractYearsRemaining: { ...household.activeInsuranceContracts },
  activeLiabilities: Object.fromEntries(
    Object.entries(household.activeLiabilities).map(([id, state]) => [id, { remainingPrincipalYen: state.remainingPrincipalYen, remainingYears: state.remainingYears }]),
  ),
  lifeStage: household.lifeStage,
  roundIndex: household.roundIndex,
  goalDelayedRounds: household.goalDelayedRounds,
  visibleConcepts,
  eventDisclosures,
  shortfallOptions,
})
