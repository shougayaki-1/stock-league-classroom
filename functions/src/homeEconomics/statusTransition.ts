import { getFirestore } from 'firebase-admin/firestore'
import { getDatabase } from 'firebase-admin/database'
import type { GoalPackage, HouseholdProfile } from '@stock-league/household-authoring-content'
import type { LifeStage } from '@stock-league/household-public-content'
import type { FirestoreTx } from '../lessonRuns/phases/transitionPhase'
import type { LessonRunStatus } from '../lessonRuns/phases/stateMachine'
import { ensureAssignedHouseholdStateWithAdminSdk } from './assignedHousehold'
import { resolveVisibleConcepts } from './goalPackage'
import { toAdvancedHouseholdTeamEntryView } from './realtimeProjection'
import {
  distinctLifeStagesInOrder,
  teamSetFingerprint,
  validateHouseholdAssignmentEntries,
  type AdvancedHouseholdCourseFormat,
  type HouseholdAssignmentEntry,
} from './householdAssignment'
import type { HouseholdAssignmentConfig } from './householdAssignmentRepository'

/**
 * Task 3's household-specific hooks for `lessonRuns/phases/transitionPhase.ts`'s
 * generic `prepareStatusTransition`/`afterStatusTransition` slots. This
 * module is the ONLY place in the codebase that knows what "starting an
 * advanced Home Economics lesson" means for the household assignment —
 * `transitionPhase.ts` itself stays subject-agnostic and just calls
 * whatever hook it was given.
 */

export interface StatusTransitionPreparation {
  writes: Array<{ path: string; data: Record<string, unknown> }>
}

export interface HouseholdRuntimeControl {
  courseFormat: AdvancedHouseholdCourseFormat
  assignmentRevision: number
  synchronizedRoundIndex: number
  roundStatus: 'OPEN' | 'SETTLING'
  activeOperationId: string | null
  updatedAtServerMillis: number
}

const ADVANCED_FORMATS = new Set<AdvancedHouseholdCourseFormat>([
  'ROLE_VARIANT', 'STAGE_SPLIT', 'MULTI_PERSON_PER_TEAM',
])

const isAdvancedHouseholdCourseFormat = (value: unknown): value is AdvancedHouseholdCourseFormat =>
  typeof value === 'string' && ADVANCED_FORMATS.has(value as AdvancedHouseholdCourseFormat)

const configPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/householdAssignment/config`
const entriesCollectionPath = (lessonRunId: string): string => `${configPath(lessonRunId)}/entries`
const controlPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/householdRuntime/control`
const teamsIndexPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/meta/teamsIndex`

interface RunSnapshotShape {
  subject?: string
  startedAt?: unknown
  orgId?: string
  templateSnapshot?: {
    homeEconomics?: {
      courseFormat?: string
      households?: HouseholdProfile[]
      goalPackage?: GoalPackage
    }
  }
}

/**
 * Called by `transitionPhase` (READ PHASE only — see this file's own
 * `getCollection` requirement below) exactly once per status transition,
 * BEFORE `transitionPhase`'s own `tx.set(runPath, ...)`. Returns `null` for
 * every case that isn't "the very first RUNNING start of an advanced
 * (ROLE_VARIANT/STAGE_SPLIT/MULTI_PERSON_PER_TEAM) Home Economics lesson" —
 * i.e. Social Studies lessons, COMMON_CONDITIONS Home Economics (no
 * per-team assignment to freeze), non-RUNNING transitions, and resumes
 * (`PAUSED -> RUNNING`, detected via `run.startedAt != null`, the exact
 * same signal `transitionPhase.ts` itself uses to decide whether to stamp
 * `startedAt` — see that file's `newStatus === 'RUNNING' && run.startedAt
 * == null` check) — so those cases get zero extra reads and zero extra
 * writes from this hook.
 *
 * Re-validation scope (see task-3-report.md for the full reasoning): reuses
 * `validateHouseholdAssignmentEntries` (Task 1) for the checks it already
 * encodes (profile/team presence, MULTI's >=2-profiles rule, STAGE_SPLIT's
 * team-count-vs-stage-count rule, overall entry count). On top of that,
 * this function re-derives three things Task 1's validator does NOT check,
 * because they require comparing the *actual persisted entries* against the
 * *current* team/profile set (something can drift between prepare/update
 * time and lesson-start time, or a MANUAL edit can produce entries that
 * still pass the count-based checks but reference something that no longer
 * exists or break format-specific coverage):
 *   1. every entry's `teamId`/`profileId` actually resolves to a real
 *      current team / template profile;
 *   2. STAGE_SPLIT: every distinct lifeStage among the current profiles is
 *      covered by at least one entry;
 *   3. MULTI_PERSON_PER_TEAM: every current team's entries are exactly the
 *      full current profile set (no missing/duplicate profile).
 * It also independently re-checks the team-set fingerprint (STALE) and
 * re-runs the READY/INVALID computation fresh rather than trusting the
 * config's cached `validationStatus`, since the DRAFT could have drifted
 * since it was last computed.
 */
export const prepareStatusTransition = async (
  tx: FirestoreTx,
  input: {
    lessonRunId: string
    run: Record<string, unknown>
    targetStatus: LessonRunStatus
    actorId: string
    nowValue: unknown
  },
): Promise<StatusTransitionPreparation | null> => {
  if (input.targetStatus !== 'RUNNING') return null

  const run = input.run as RunSnapshotShape
  if (run.subject !== 'HOME_ECONOMICS') return null
  if (run.startedAt != null) return null // resume (PAUSED -> RUNNING), not a first start

  const courseFormat = run.templateSnapshot?.homeEconomics?.courseFormat
  if (!isAdvancedHouseholdCourseFormat(courseFormat)) return null

  const profiles = run.templateSnapshot?.homeEconomics?.households ?? []

  if (!tx.getCollection) {
    throw new Error('HouseholdAssignment freeze requires a Firestore transaction with getCollection support')
  }

  const configSnap = await tx.get(configPath(input.lessonRunId))
  if (!configSnap.exists) {
    throw new Error('HouseholdAssignment has not been prepared for this lesson yet')
  }
  const config = configSnap.data() as unknown as HouseholdAssignmentConfig
  // Already frozen (should not normally happen given the startedAt guard
  // above, but a resume racing a retried first-start request could
  // theoretically observe this) — nothing further to do, and re-freezing
  // would incorrectly reset the runtime control document.
  if (config.state === 'FROZEN') return null

  const entryDocs = await tx.getCollection(entriesCollectionPath(input.lessonRunId))
  const entries = entryDocs.map((doc) => doc.data as unknown as HouseholdAssignmentEntry)

  const teamsIndexSnap = await tx.get(teamsIndexPath(input.lessonRunId))
  const teamIds = teamsIndexSnap.exists
    ? ((teamsIndexSnap.data() as { teamIds?: string[] } | undefined)?.teamIds ?? [])
    : []

  if (config.teamSetFingerprint !== teamSetFingerprint(teamIds)) {
    throw new Error('HouseholdAssignment is stale: the team set has changed since it was last prepared')
  }

  const validation = validateHouseholdAssignmentEntries({ courseFormat, teamIds, profiles, entries })
  if (validation.status !== 'READY') {
    throw new Error(
      `HouseholdAssignment is not ready to start: ${validation.warnings.map((warning) => warning.code).join(', ')}`,
    )
  }

  const teamIdSet = new Set(teamIds)
  const profileIdSet = new Set(profiles.map((profile) => profile.householdId))
  for (const entry of entries) {
    if (!teamIdSet.has(entry.teamId)) {
      throw new Error(`HouseholdAssignment references a team that no longer exists: ${entry.teamId}`)
    }
    if (!profileIdSet.has(entry.profileId)) {
      throw new Error(`HouseholdAssignment references a profile that no longer exists: ${entry.profileId}`)
    }
  }

  if (courseFormat === 'STAGE_SPLIT') {
    const profileById = new Map(profiles.map((profile) => [profile.householdId, profile] as const))
    const expectedStages = distinctLifeStagesInOrder(profiles)
    const coveredStages: Set<string> = new Set(
      entries.map((entry) => profileById.get(entry.profileId)?.lifeStage).filter((stage): stage is LifeStage => Boolean(stage)),
    )
    const missingStage = expectedStages.find((stage) => !coveredStages.has(stage))
    if (missingStage) {
      throw new Error(`HouseholdAssignment is missing coverage for lifeStage: ${missingStage}`)
    }
  }

  if (courseFormat === 'MULTI_PERSON_PER_TEAM') {
    for (const teamId of teamIds) {
      const teamProfileIds = entries.filter((entry) => entry.teamId === teamId).map((entry) => entry.profileId)
      const teamProfileIdSet = new Set(teamProfileIds)
      const hasExactFullSet = teamProfileIds.length === profileIdSet.size
        && teamProfileIdSet.size === profileIdSet.size
        && [...profileIdSet].every((profileId) => teamProfileIdSet.has(profileId))
      if (!hasExactFullSet) {
        throw new Error(`HouseholdAssignment team does not have the full profile set: ${teamId}`)
      }
    }
  }

  const nowMillis = Date.now()
  const control: HouseholdRuntimeControl = {
    courseFormat,
    assignmentRevision: config.assignmentRevision,
    synchronizedRoundIndex: 0,
    roundStatus: 'OPEN',
    activeOperationId: null,
    updatedAtServerMillis: nowMillis,
  }

  return {
    writes: [
      {
        path: configPath(input.lessonRunId),
        data: {
          ...config,
          state: 'FROZEN',
          frozenByUid: input.actorId,
          frozenAtServerMillis: nowMillis,
        } as unknown as Record<string, unknown>,
      },
      {
        path: controlPath(input.lessonRunId),
        data: control as unknown as Record<string, unknown>,
      },
    ],
  }
}

/**
 * Post-commit hook (Task 9). Runs strictly after `prepareStatusTransition`'s
 * writes have committed (see `transitionPhase.ts`'s
 * `TransitionPhaseDeps.afterStatusTransition` JSDoc). For the very first
 * RUNNING start of an advanced (ROLE_VARIANT/STAGE_SPLIT/
 * MULTI_PERSON_PER_TEAM) Home Economics lesson, this:
 *
 * 1. Ensures every FROZEN assignment entry's `HouseholdState` document
 *    actually exists (`ensureAssignedHouseholdStateWithAdminSdk`, Task 4 —
 *    already idempotent: a second call just returns the existing doc).
 * 2. Publishes an INITIAL `AdvancedHouseholdTeamStateView` to each team's
 *    `lessonRunTeamState/{lessonRunId}/{teamId}` RTDB node, so `/play` can
 *    detect household mode (and each household's starting state) before
 *    any round is ever settled — otherwise a student landing on `/play`
 *    between FROZEN and the first `processRound` call would see nothing.
 *
 * Deliberately re-reads everything it needs directly from Firestore
 * (`lessonRuns/{id}`, the HouseholdAssignmentConfig + its frozen entries,
 * `HouseholdRuntimeControl`) rather than widening this hook's signature —
 * `transitionPhase.ts`'s `TransitionPhaseDeps.afterStatusTransition` is
 * SHARED, subject-agnostic plumbing (Task 3's territory), and every other
 * `*WithAdminSdk` function in this codebase is a self-sufficient read
 * rather than requiring its caller to pre-fetch everything
 * (`ensureAssignedHouseholdStateWithAdminSdk` itself is the closest
 * precedent). This keeps `transitionPhase.ts` completely untouched.
 *
 * Self-gates identically to `prepareStatusTransition` (non-RUNNING /
 * non-HOME_ECONOMICS / COMMON_CONDITIONS / config not FROZEN all return
 * early with no writes) so a Social Studies lesson or a resume costs at
 * most a couple of extra reads, never a write. Naturally idempotent: a
 * deduplicated replay (`input.deduplicated === true`, which this hook is
 * still invoked for, per its JSDoc requirement) re-ensures already-existing
 * `HouseholdState` docs (no-op) and re-publishes the same deterministic
 * initial view via RTDB `.update()` (a no-op in effect the second time).
 * Runs entirely outside any Firestore transaction — the sequential reads/
 * writes below are plain post-commit I/O, not a new transaction of their
 * own.
 */
export const afterStatusTransition = async (input: {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  deduplicated: boolean
}): Promise<void> => {
  if (input.targetStatus !== 'RUNNING') return

  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
  if (!runSnap.exists) return
  const run = runSnap.data() as RunSnapshotShape
  if (run.subject !== 'HOME_ECONOMICS') return

  const courseFormat = run.templateSnapshot?.homeEconomics?.courseFormat
  if (!isAdvancedHouseholdCourseFormat(courseFormat)) return

  const configSnap = await db.doc(configPath(input.lessonRunId)).get()
  if (!configSnap.exists) return
  const config = configSnap.data() as unknown as HouseholdAssignmentConfig
  // Only publish once the assignment is actually FROZEN — for a first
  // RUNNING transition this is always true (prepareStatusTransition just
  // froze it in the SAME committed transaction), but this hook re-checks
  // rather than assuming, since it re-reads independently.
  if (config.state !== 'FROZEN') return

  const controlSnap = await db.doc(controlPath(input.lessonRunId)).get()
  if (!controlSnap.exists) return
  const control = controlSnap.data() as unknown as HouseholdRuntimeControl

  const entriesSnap = await db.collection(entriesCollectionPath(input.lessonRunId)).get()
  const entries = entriesSnap.docs.map((doc) => doc.data() as unknown as HouseholdAssignmentEntry)
  if (entries.length === 0) return

  const profiles = run.templateSnapshot?.homeEconomics?.households ?? []
  const profileById = new Map(profiles.map((profile) => [profile.householdId, profile] as const))
  const goalPackage = run.templateSnapshot?.homeEconomics?.goalPackage
  const visibleConcepts = goalPackage ? resolveVisibleConcepts(goalPackage) : []

  const entriesByTeam = new Map<string, HouseholdAssignmentEntry[]>()
  for (const entry of entries) {
    const list = entriesByTeam.get(entry.teamId)
    if (list) list.push(entry)
    else entriesByTeam.set(entry.teamId, [entry])
  }

  const rtdb = getDatabase()
  for (const [teamId, teamEntries] of entriesByTeam) {
    const orderedEntries = [...teamEntries].sort((a, b) => a.displayOrder - b.displayOrder)
    const householdEntryViews: Record<string, unknown> = {}
    for (const entry of orderedEntries) {
      const profile = profileById.get(entry.profileId)
      if (!profile) continue // validated at freeze time (prepareStatusTransition) — should never happen here
      // Idempotent — ensureAssignedHouseholdStateWithAdminSdk returns the
      // existing document unchanged on a deduplicated replay.
      const householdState = await ensureAssignedHouseholdStateWithAdminSdk(input.lessonRunId, entry.householdId)
      // Initial publish, before any round has ever been settled: no life
      // events have occurred yet and there is no shortfall to resolve —
      // and no decision has been submitted for round 0 yet either.
      householdEntryViews[entry.householdId] = toAdvancedHouseholdTeamEntryView(
        profile, householdState, visibleConcepts, [], [], null,
      )
    }

    await rtdb.ref(`lessonRunTeamState/${input.lessonRunId}/${teamId}`).update({
      orgId: run.orgId,
      courseFormat: control.courseFormat,
      synchronizedRoundIndex: control.synchronizedRoundIndex,
      roundStatus: control.roundStatus,
      households: householdEntryViews,
      householdOrder: orderedEntries.map((entry) => entry.householdId),
      updatedAtMillis: Date.now(),
    })
  }
}
