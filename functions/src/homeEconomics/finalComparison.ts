import { getFirestore } from 'firebase-admin/firestore'
import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import type {
  HouseholdClassComparisonHouseholdView,
  HouseholdClassComparisonPublicView,
  HouseholdClassComparisonTeamView,
} from '@stock-league/household-public-content'
import type { HouseholdState } from '../lessonRuns/households/repository'
import type { FirestoreTx } from '../lessonRuns/phases/transitionPhase'
import { computeLifeGoalAchievementScore } from './evaluation'
import { toHouseholdProfilePublicView } from './toPublicView'
import type { AdvancedHouseholdCourseFormat, HouseholdAssignmentEntry } from './householdAssignment'
import type { HouseholdBulkSettlementOperation } from './bulkSettlementOperation'

/**
 * Task 12: the class-wide, privacy-safe comparison published the moment an
 * advanced (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) Home Economics
 * lesson transitions RUNNING -> REFLECTION. This module owns the PURE
 * comparison-building logic plus its Admin SDK wiring; `statusTransition.ts`
 * (Task 3/9's REFLECTION branch) is the only caller — it does the actual
 * transactional reads (control/entries/states/teams) and calls into this
 * module's pure functions rather than inlining any of this logic itself.
 */

export const householdFinalComparisonPath = (lessonRunId: string): string =>
  `lessonRuns/${lessonRunId}/householdFinalComparison/result`

/**
 * Reads whether an unresolved (not COMPLETED, not CANCELLED)
 * `HouseholdBulkSettlementOperation` exists for this lesson run — through
 * the SAME Firestore transaction (`tx`) every other read in
 * `prepareReflectionTransition` uses, so this check is genuinely covered by
 * the transaction's snapshot isolation and cannot observe a different
 * bulk-operation state on a transaction retry than the OTHER (transactional)
 * reads captured in that same attempt.
 *
 * `householdBulkSettlementOperations` is a genuinely TOP-LEVEL collection,
 * unscoped by `lessonRunId` (queried elsewhere with
 * `.where('lessonRunId', '==', ...)` — see `bulkSettlementOperation.ts`'s
 * `findUnresolvedBulkSettlementOperationWithAdminSdk`), unlike every other
 * `tx.getCollection` call site in this codebase, which reads a subcollection
 * already scoped under `lessonRuns/{lessonRunId}/...`. Rather than requiring
 * a query-capable transactional read method, this reads the collection's
 * FULL contents via the existing `tx.getCollection(path)` — which the Admin
 * SDK's `Transaction.get()` already supports for any `CollectionReference`
 * (a `Query`), not only single documents; see `transitionPhaseWithAdminSdk`'s
 * `getCollection` wiring in `transitionPhase.ts`, which is just `tx.get(db.collection(path))`
 * with no `.where(...)` applied — and filters by `lessonRunId`/`status` in
 * application code below. That filtering runs over data that is already part
 * of `tx`'s own read set, so it inherits the transaction's snapshot
 * isolation: a retry re-reads (and re-filters) the exact same consistent
 * snapshot the rest of `prepareReflectionTransition`'s reads observe on that
 * attempt, unlike a plain `.where(...).get()` issued outside `tx`. This
 * trades a wider read (every lesson run's bulk operations, not just this
 * one's) for that consistency guarantee — acceptable here since this
 * collection is not expected to grow large relative to a single
 * transaction's read cost.
 */
export const hasUnresolvedBulkSettlementOperationInTransaction = async (
  tx: FirestoreTx,
  lessonRunId: string,
): Promise<boolean> => {
  if (!tx.getCollection) {
    throw new Error('Household final comparison requires a Firestore transaction with getCollection support')
  }
  const docs = await tx.getCollection('householdBulkSettlementOperations')
  return docs.some((doc) => {
    const op = doc.data as unknown as HouseholdBulkSettlementOperation
    return op.lessonRunId === lessonRunId && op.status !== 'COMPLETED' && op.status !== 'CANCELLED'
  })
}

/** Reads back the already-committed comparison snapshot, for `afterStatusTransition`'s post-commit RTDB republish. Never recomputes it. */
export const readHouseholdFinalComparisonWithAdminSdk = async (
  lessonRunId: string,
): Promise<HouseholdClassComparisonPublicView | null> => {
  const snap = await getFirestore().doc(householdFinalComparisonPath(lessonRunId)).get()
  if (!snap.exists) return null
  return snap.data() as unknown as HouseholdClassComparisonPublicView
}

export interface HouseholdReflectionGateInput {
  roundStatus: 'OPEN' | 'SETTLING'
  activeOperationId: string | null
  synchronizedRoundIndex: number
  hasUnresolvedBulkOperation: boolean
  /** Every currently-provisioned household's own `roundIndex`, for the alignment check. */
  householdRoundIndices: number[]
}

/**
 * Pure REFLECTION-gate evaluator. Returns a human-readable rejection reason,
 * or `null` when the lesson is safe to enter REFLECTION and publish the
 * final comparison. Order matches the brief's own listing (SETTLING, active
 * operation, no synchronized round yet, unresolved bulk, misaligned rounds).
 */
export const evaluateHouseholdReflectionGate = (input: HouseholdReflectionGateInput): string | null => {
  if (input.roundStatus === 'SETTLING') {
    return 'a bulk settlement is currently SETTLING'
  }
  if (input.activeOperationId !== null) {
    return 'a bulk settlement operation is still locked on HouseholdRuntimeControl'
  }
  if (input.synchronizedRoundIndex === 0) {
    return 'no synchronized round has completed yet; there is nothing to compare'
  }
  if (input.hasUnresolvedBulkOperation) {
    return 'an unresolved bulk settlement operation exists for this lesson run'
  }
  const distinctRoundIndices = new Set(input.householdRoundIndices)
  if (distinctRoundIndices.size > 1) {
    return 'households are not aligned on the same round index'
  }
  return null
}

export interface BuildHouseholdClassComparisonInput {
  courseFormat: AdvancedHouseholdCourseFormat
  /** `HouseholdRuntimeControl.synchronizedRoundIndex` at REFLECTION time — see `HouseholdClassComparisonPublicView.finalRoundCount`'s own JSDoc for why this (not any individual household's `roundIndex`) is used. */
  finalRoundCount: number
  publishedAtMillis: number
  teams: Array<{ teamId: string; displayName: string }>
  /** FROZEN assignment entries for this lesson run. */
  entries: HouseholdAssignmentEntry[]
  /** The template snapshot's authored profiles (`HomeEconomicsContent.households`). */
  profiles: HouseholdProfile[]
  /** Keyed by RUNTIME householdId (`HouseholdAssignmentEntry.householdId`). */
  householdStates: Record<string, HouseholdState>
}

/**
 * Pure builder. Builds the safe comparison through an EXPLICIT ALLOW-LIST —
 * every field of `HouseholdClassComparisonHouseholdView` is assigned one at
 * a time below, and `profile` is produced exclusively through
 * `toHouseholdProfilePublicView()` — this function never spreads `profile`
 * or `state` (internal `HouseholdProfile`/`HouseholdState` objects) into the
 * output, so `internalRiskFactors`/`eventProbabilityOverrides` and any
 * opaque runtime householdId can never leak in.
 */
export const buildHouseholdClassComparisonPublicView = (
  input: BuildHouseholdClassComparisonInput,
): HouseholdClassComparisonPublicView => {
  const profileById = new Map(input.profiles.map((profile) => [profile.householdId, profile] as const))

  const entriesByTeam = new Map<string, HouseholdAssignmentEntry[]>()
  for (const entry of input.entries) {
    const list = entriesByTeam.get(entry.teamId)
    if (list) list.push(entry)
    else entriesByTeam.set(entry.teamId, [entry])
  }

  const sortedTeams = [...input.teams].sort((a, b) => a.teamId.localeCompare(b.teamId))
  const teams: HouseholdClassComparisonTeamView[] = []

  for (const team of sortedTeams) {
    const teamEntries = [...(entriesByTeam.get(team.teamId) ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)
    if (teamEntries.length === 0) continue

    const households: HouseholdClassComparisonHouseholdView[] = []
    for (const entry of teamEntries) {
      const state = input.householdStates[entry.householdId]
      const profile = profileById.get(entry.profileId)
      // Defensive: a FROZEN entry should always resolve both a state (Task
      // 4/9 ensure this at RUNNING start) and a profile (validated at
      // freeze time) — skip rather than throw so one stale entry can't take
      // down the whole class comparison.
      if (!state || !profile) continue

      const totalAssetsYen = Object.values(state.assetHoldingsYen).reduce((sum, value) => sum + value, 0)
      const totalLiabilitiesYen = Object.values(state.activeLiabilities)
        .reduce((sum, liability) => sum + liability.remainingPrincipalYen, 0)

      households.push({
        profileId: entry.profileId,
        profile: toHouseholdProfilePublicView(profile),
        cashYen: state.cashYen,
        totalAssetsYen,
        totalLiabilitiesYen,
        goalDelayedRounds: state.goalDelayedRounds,
        lifeGoalAchievementScore: computeLifeGoalAchievementScore({
          goalDelayedRounds: state.goalDelayedRounds,
          totalRounds: input.finalRoundCount,
        }),
      })
    }

    if (households.length === 0) continue
    teams.push({ teamDisplayName: team.displayName, households })
  }

  return {
    courseFormat: input.courseFormat,
    finalRoundCount: input.finalRoundCount,
    publishedAtMillis: input.publishedAtMillis,
    teams,
  }
}
