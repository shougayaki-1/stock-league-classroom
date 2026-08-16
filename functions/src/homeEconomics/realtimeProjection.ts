import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import type { HouseholdProfilePublicView } from '@stock-league/household-public-content'
import type { HouseholdState } from '../lessonRuns/households/repository'
import type { ConceptCategory } from './goalPackage'
import type { EventDisclosureView } from './engine/lifeEvents'
import type { ShortfallOption } from './engine/shortfallOptions'
import type { AdvancedHouseholdCourseFormat } from './householdAssignment'
import { toHouseholdProfilePublicView } from './toPublicView'
import type { HouseholdRuntimeControl } from './statusTransition'

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

/**
 * Task 9 — one household's entry within an advanced (ROLE_VARIANT/
 * STAGE_SPLIT/MULTI_PERSON_PER_TEAM) team's `lessonRunTeamState/{lessonRunId}/
 * {teamId}` node. Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's
 * type of the same name — hand-synced, see this file's own top-level JSDoc
 * for why (functions/src cannot import across the functions/src rootDir
 * boundary into src/).
 */
export interface AdvancedHouseholdTeamEntryView {
  householdId: string
  profile: HouseholdProfilePublicView
  state: HouseholdStateTeamView
  /**
   * Which round this household has an on-record submitted decision for, or
   * `null` when it has not yet submitted for its CURRENT round
   * (`state.roundIndex`). See `toAdvancedHouseholdTeamEntryView`'s JSDoc for
   * how callers are expected to compute this.
   */
  submittedRoundIndex: number | null
}

/**
 * Task 9 — the advanced-format counterpart of `HouseholdStateTeamView`'s
 * single-household `lessonRunTeamState/{lessonRunId}/{teamId}` node (Common
 * writes `.household` only; see `processRound.ts`'s
 * `publishRealtimeStateWithAdminSdk` for the branch). A team running
 * ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM can host more than one
 * runtime household (MULTI_PERSON_PER_TEAM: every profile, on the same
 * team), so this node instead carries a `households` map keyed by runtime
 * `householdId`, plus `householdOrder` (display order) and the
 * team-agnostic `courseFormat`/`synchronizedRoundIndex`/`roundStatus` read
 * from `HouseholdRuntimeControl` (`statusTransition.ts`) at publish time.
 * Server-side counterpart of src/lib/lessonRuns/liveTypes.ts's type of the
 * same name — hand-synced, see this file's own top-level JSDoc.
 */
export interface AdvancedHouseholdTeamStateView {
  courseFormat: AdvancedHouseholdCourseFormat
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  households: Record<string, AdvancedHouseholdTeamEntryView>
  householdOrder: string[]
}

/**
 * Projects one household's authored `HouseholdProfile` (via
 * `toHouseholdProfilePublicView`, Task 6's privacy allow-list) plus its
 * runtime `HouseholdState` (via `toHouseholdStateTeamView` above) down to
 * one entry of an `AdvancedHouseholdTeamStateView`. Allow-list only, same
 * discipline as `toHouseholdStateTeamView` — never `{...profile}`.
 */
export const toAdvancedHouseholdTeamEntryView = (
  profile: HouseholdProfile,
  household: HouseholdState,
  visibleConcepts: ConceptCategory[],
  eventDisclosures: EventDisclosureView[],
  shortfallOptions: ShortfallOption[],
  submittedRoundIndex: number | null,
): AdvancedHouseholdTeamEntryView => ({
  householdId: household.householdId,
  profile: toHouseholdProfilePublicView(profile),
  state: toHouseholdStateTeamView(household, visibleConcepts, eventDisclosures, shortfallOptions),
  submittedRoundIndex,
})

/**
 * Assembles a full `AdvancedHouseholdTeamStateView` from a team's already-
 * projected per-household entries, in caller-supplied order (callers pass
 * entries pre-sorted by `HouseholdAssignmentEntry.displayOrder`, Task 1/3) —
 * this function only derives `households`/`householdOrder` from that order,
 * it does not re-sort.
 */
export const toAdvancedHouseholdTeamStateView = (
  courseFormat: AdvancedHouseholdCourseFormat,
  synchronizedRoundIndex: number,
  roundStatus: 'OPEN' | 'SETTLING',
  entries: AdvancedHouseholdTeamEntryView[],
): AdvancedHouseholdTeamStateView => ({
  courseFormat,
  synchronizedRoundIndex,
  roundStatus,
  households: Object.fromEntries(entries.map((entry) => [entry.householdId, entry])),
  householdOrder: entries.map((entry) => entry.householdId),
})

/**
 * Critical C1 (whole-branch review) fix — the ONE shared field-builder for
 * the control-derived trio (`courseFormat`/`synchronizedRoundIndex`/
 * `roundStatus`) every writer of an advanced-format
 * `lessonRunTeamState/{lessonRunId}/{teamId}` node must publish in
 * agreement. Before this existed, `statusTransition.ts`'s
 * `afterStatusTransition`, `processRound.ts`'s
 * `publishRealtimeStateWithAdminSdk`, `bulkSettlementOperation.ts`'s
 * `finalizeBulkSettlementOperation`, and `householdRestore.ts`'s v3 restore
 * each hand-rolled this same 3-field object independently — and had already
 * drifted: `finalizeBulkSettlementOperation` never wrote it at all after a
 * bulk settlement completed (leaving every team's RTDB node permanently
 * showing `roundStatus: 'SETTLING'`, so students could never submit again),
 * and v3 restore's RTDB write never included it either. Pure — callers are
 * responsible for the actual RTDB `.update()` call (never `.set()`, so this
 * node's `households`/`householdOrder` fields, managed by sibling writes,
 * are never clobbered).
 */
export const advancedTeamControlStateFields = (
  control: Pick<HouseholdRuntimeControl, 'courseFormat' | 'synchronizedRoundIndex' | 'roundStatus'>,
): Pick<AdvancedHouseholdTeamStateView, 'courseFormat' | 'synchronizedRoundIndex' | 'roundStatus'> => ({
  courseFormat: control.courseFormat,
  synchronizedRoundIndex: control.synchronizedRoundIndex,
  roundStatus: control.roundStatus,
})
