import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import {
  buildInitialHouseholdState,
  householdRepositoryWithAdminSdk,
  type HouseholdFirestoreDeps,
  type HouseholdState,
} from '../lessonRuns/households/repository'
import type { HouseholdAssignmentEntry } from './householdAssignment'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'

/**
 * Initializer for the 3 advanced-format households (ROLE_VARIANT/
 * STAGE_SPLIT/MULTI_PERSON_PER_TEAM) — the counterpart to
 * `commonConditionsHousehold.ts`'s COMMON_CONDITIONS lazy-init path.
 *
 * Unlike COMMON_CONDITIONS (`householdId === teamId`, exactly one authored
 * profile, so `teamId`/starting values can be derived positionally), an
 * advanced-format household's runtime `householdId` is an opaque
 * per-team-slot id (`runtimeHouseholdId()`, Task 1) that never collides
 * with the profile it plays and can be shared by more than one team
 * (MULTI_PERSON_PER_TEAM). Its `teamId`/`profileId` are therefore only
 * knowable by looking them up in the FROZEN `HouseholdAssignmentConfig`
 * (Task 2/3) — never inferred from `householdId` itself.
 */
export interface GetOrInitAssignedHouseholdStateInput extends HouseholdFirestoreDeps {
  lessonRunId: string
  householdId: string
  teamId: string
  profileId: string
  startingCashYen: number
  startingLifeStage: string
  now: () => number
}

/**
 * The get-or-init half of the assigned-household flow. This intentionally
 * does NOT reuse `getOrInitHouseholdState()` from `repository.ts` as-is:
 * that function's "existing doc? return it unchanged" branch has no notion
 * of a `teamId`/`profileId` it should be validating the existing doc
 * against — COMMON_CONDITIONS's lazy-init has nothing to validate, since
 * `teamId`/`profileId` there are always derivable from `householdId`
 * itself. Here, an existing doc whose persisted `teamId`/`profileId` don't
 * match what the FROZEN assignment entry says they should be is a serious
 * data-integrity problem (should never happen if Task 3's freeze logic is
 * correct) and must throw rather than silently be returned or overwritten.
 * It DOES reuse `buildInitialHouseholdState()` and the same
 * `HouseholdFirestoreDeps`/`HouseholdTx` transaction shape (all reads
 * before all writes), so the two initializers stay structurally parallel
 * rather than diverging.
 */
export const getOrInitAssignedHouseholdState = (
  input: GetOrInitAssignedHouseholdStateInput,
): Promise<HouseholdState> => input.firestore.runTransaction(async (tx) => {
  const path = `lessonRuns/${input.lessonRunId}/households/${input.householdId}`
  // ---- ALL READS FIRST ----
  const existing = await tx.get(path)
  if (existing.exists) {
    const state = existing.data() as unknown as HouseholdState
    if (state.teamId !== input.teamId || state.profileId !== input.profileId) {
      throw new Error(
        `HouseholdState ${input.householdId} already exists with teamId=${state.teamId}/profileId=${state.profileId}, `
        + `which does not match the frozen HouseholdAssignmentEntry (teamId=${input.teamId}/profileId=${input.profileId}).`,
      )
    }
    return state
  }

  // ---- ALL WRITES AFTER ----
  const state = buildInitialHouseholdState({
    lessonRunId: input.lessonRunId,
    teamId: input.teamId,
    householdId: input.householdId,
    profileId: input.profileId,
    startingCashYen: input.startingCashYen,
    startingLifeStage: input.startingLifeStage,
    nowMillis: input.now(),
  })
  tx.set(path, state as unknown as Record<string, unknown>)
  return state
})

/**
 * Admin SDK wiring: resolves the FROZEN `HouseholdAssignmentEntry` and its
 * template-snapshot `HouseholdProfile` for `householdId`, then delegates to
 * `getOrInitAssignedHouseholdState`. Requires the assignment to actually be
 * `state === 'FROZEN'` — a household can only be initialized once the
 * teacher has locked in the assignment and the lesson has started, per
 * Task 3 — throwing otherwise so a DRAFT/STALE/UNPREPARED assignment can
 * never be used to fabricate runtime household state.
 */
export const ensureAssignedHouseholdStateWithAdminSdk = async (
  lessonRunId: string,
  householdId: string,
): Promise<HouseholdState> => {
  const db = getFirestore()

  const configSnap = await db.doc(`lessonRuns/${lessonRunId}/householdAssignment/config`).get()
  if (!configSnap.exists) throw new Error('HouseholdAssignment has not been prepared for this lesson run.')
  const config = configSnap.data() as unknown as HouseholdAssignmentConfig
  if (config.state !== 'FROZEN') {
    throw new Error(`HouseholdAssignment must be FROZEN before households can be initialized (current state: ${config.state}).`)
  }

  const entriesSnap = await db.collection(`lessonRuns/${lessonRunId}/householdAssignment/config/entries`).get()
  const entry = entriesSnap.docs
    .map((doc) => doc.data() as unknown as HouseholdAssignmentEntry)
    .find((candidate) => candidate.householdId === householdId)
  if (!entry) throw new Error(`No frozen HouseholdAssignmentEntry found for householdId ${householdId}.`)

  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new Error('レッスンランが見つかりません。')
  const templateSnapshot = runSnap.get('templateSnapshot') as { homeEconomics?: HomeEconomicsContent } | undefined
  const homeEconomics = templateSnapshot?.homeEconomics
  if (!homeEconomics) throw new Error('LessonRun has no homeEconomics content')

  const profile = homeEconomics.households.find((candidate) => candidate.householdId === entry.profileId)
  if (!profile) throw new Error(`HouseholdProfile not found in template snapshot for profileId ${entry.profileId}.`)

  return getOrInitAssignedHouseholdState({
    firestore: householdRepositoryWithAdminSdk(),
    lessonRunId,
    householdId,
    teamId: entry.teamId,
    profileId: entry.profileId,
    startingCashYen: profile.cashSavingsYen,
    startingLifeStage: profile.lifeStage,
    now: Date.now,
  })
}
