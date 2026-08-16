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
import type { HouseholdState } from '../lessonRuns/households/repository'
import {
  buildHouseholdClassComparisonPublicView,
  evaluateHouseholdReflectionGate,
  hasUnresolvedBulkSettlementOperationWithAdminSdk,
  householdFinalComparisonPath,
  readHouseholdFinalComparisonWithAdminSdk,
} from './finalComparison'

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
const householdsCollectionPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/households`
const teamsCollectionPath = (lessonRunId: string): string => `lessonRuns/${lessonRunId}/teams`

/** Hand-synced with `teacherDashboard.ts`'s `normalizeTeamDisplayName` — kept local rather than imported to avoid a `statusTransition.ts` <-> `teacherDashboard.ts` runtime import cycle (`teacherDashboard.ts` already does `import type { HouseholdRuntimeControl } from './statusTransition'`). */
const normalizeTeamDisplayName = (teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : teamId
}

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
/**
 * Dispatcher for `transitionPhase.ts`'s `TransitionPhaseDeps.prepareStatusTransition`
 * hook slot. `transitionPhase.ts` itself needed ZERO changes to support the
 * REFLECTION branch below — it already calls this hook generically for
 * ANY `input.targetStatus` (Task 3's design), so this module simply grew a
 * second case rather than requiring any change to the caller.
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
  if (input.targetStatus === 'RUNNING') return prepareRunningTransition(tx, input)
  if (input.targetStatus === 'REFLECTION') return prepareReflectionTransition(tx, input)
  return null
}

const prepareRunningTransition = async (
  tx: FirestoreTx,
  input: {
    lessonRunId: string
    run: Record<string, unknown>
    targetStatus: LessonRunStatus
    actorId: string
    nowValue: unknown
  },
): Promise<StatusTransitionPreparation | null> => {
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
 * Task 12: the REFLECTION-gate + final-comparison counterpart of
 * `prepareRunningTransition` above. Self-gates identically for the
 * non-advanced-format cases (non-HOME_ECONOMICS, COMMON_CONDITIONS, and —
 * new here — "the assignment was never frozen / RUNNING never actually
 * happened for this format", which returns `null` defensively even though
 * the `LessonRunStatus` state machine should make it unreachable) and
 * returns `null` with zero extra reads/writes for those. For a genuine
 * advanced-format RUNNING -> REFLECTION transition:
 *
 * 1. Reads (read-only, inside the transaction's read phase) the
 *    `HouseholdRuntimeControl`, the FROZEN assignment's entries, every
 *    entry's `HouseholdState`, and the lesson's team display names.
 * 2. Checks for an unresolved bulk settlement operation via
 *    `finalComparison.ts`'s `hasUnresolvedBulkSettlementOperationWithAdminSdk`
 *    — a deliberate NON-transactional read (see that function's own JSDoc
 *    for why: the operations collection is top-level and unscoped by
 *    lessonRunId, so it cannot be expressed through `tx.getCollection`'s
 *    scoped-subcollection-only signature).
 * 3. Evaluates the REFLECTION gate (`finalComparison.ts`'s
 *    `evaluateHouseholdReflectionGate`) — THROWS (failing the whole
 *    transition, so the lesson does NOT move to REFLECTION) if SETTLING, an
 *    active operation lock, no synchronized round yet, an unresolved bulk
 *    operation, or misaligned household rounds is detected.
 * 4. Builds the privacy-safe `HouseholdClassComparisonPublicView`
 *    (`finalComparison.ts`'s pure `buildHouseholdClassComparisonPublicView`
 *    — explicit allow-list, `toHouseholdProfilePublicView()`, never a spread
 *    of `HouseholdProfile`/`HouseholdState`) and returns it as a WRITE to
 *    `householdFinalComparisonPath`, to be applied by `transitionPhase.ts`
 *    atomically with the RUNNING -> REFLECTION status write itself.
 *
 * Deliberately does NOT publish to RTDB here — that is
 * `afterStatusTransition`'s post-commit job below, reading this SAME
 * already-committed Firestore doc back rather than recomputing it, so a
 * deduplicated replay can safely re-publish without re-running any of the
 * gate checks or re-touching any HouseholdState.
 */
const prepareReflectionTransition = async (
  tx: FirestoreTx,
  input: {
    lessonRunId: string
    run: Record<string, unknown>
    targetStatus: LessonRunStatus
    actorId: string
    nowValue: unknown
  },
): Promise<StatusTransitionPreparation | null> => {
  const run = input.run as RunSnapshotShape
  if (run.subject !== 'HOME_ECONOMICS') return null

  const courseFormat = run.templateSnapshot?.homeEconomics?.courseFormat
  if (!isAdvancedHouseholdCourseFormat(courseFormat)) return null

  if (!tx.getCollection) {
    throw new Error('Household final comparison requires a Firestore transaction with getCollection support')
  }

  const configSnap = await tx.get(configPath(input.lessonRunId))
  const config = configSnap.exists ? (configSnap.data() as unknown as HouseholdAssignmentConfig) : null
  // Defensive: the state machine requires RUNNING before REFLECTION, and
  // `prepareRunningTransition` always freezes the assignment for an advanced
  // format's first RUNNING start — so this should never actually be
  // unfrozen/missing here. Returning null (no-op) rather than throwing keeps
  // this hook's self-gating symmetric with every other "not this hook's
  // case" branch above.
  if (!config || config.state !== 'FROZEN') return null

  const controlSnap = await tx.get(controlPath(input.lessonRunId))
  if (!controlSnap.exists) return null
  const control = controlSnap.data() as unknown as HouseholdRuntimeControl

  const entryDocs = await tx.getCollection(entriesCollectionPath(input.lessonRunId))
  const entries = entryDocs.map((doc) => doc.data as unknown as HouseholdAssignmentEntry)

  const stateDocs = await tx.getCollection(householdsCollectionPath(input.lessonRunId))
  const householdStates: Record<string, HouseholdState> = {}
  for (const doc of stateDocs) householdStates[doc.id] = doc.data as unknown as HouseholdState

  const teamDocs = await tx.getCollection(teamsCollectionPath(input.lessonRunId))
  const teams = teamDocs.map((doc) => ({ teamId: doc.id, displayName: normalizeTeamDisplayName(doc.id, doc.data) }))

  const hasUnresolvedBulkOperation = await hasUnresolvedBulkSettlementOperationWithAdminSdk(input.lessonRunId)

  const gateFailure = evaluateHouseholdReflectionGate({
    roundStatus: control.roundStatus,
    activeOperationId: control.activeOperationId,
    synchronizedRoundIndex: control.synchronizedRoundIndex,
    hasUnresolvedBulkOperation,
    householdRoundIndices: Object.values(householdStates).map((state) => state.roundIndex),
  })
  if (gateFailure) {
    throw new Error(`Cannot enter REFLECTION: ${gateFailure}`)
  }

  const profiles = run.templateSnapshot?.homeEconomics?.households ?? []
  const comparison = buildHouseholdClassComparisonPublicView({
    courseFormat,
    finalRoundCount: control.synchronizedRoundIndex,
    publishedAtMillis: Date.now(),
    teams,
    entries,
    profiles,
    householdStates,
  })

  return {
    writes: [
      {
        path: householdFinalComparisonPath(input.lessonRunId),
        data: comparison as unknown as Record<string, unknown>,
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
  if (input.targetStatus === 'REFLECTION') return afterReflectionTransition(input)
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

/**
 * Task 12's post-commit half of the REFLECTION branch. Runs strictly after
 * `prepareReflectionTransition`'s `HouseholdClassComparisonPublicView` write
 * has committed to Firestore (`householdFinalComparisonPath`) atomically
 * with the RUNNING -> REFLECTION status write itself — this function
 * deliberately does NOT recompute the comparison (no re-read of control/
 * entries/states/teams, no re-evaluation of the REFLECTION gate): it reads
 * the already-persisted snapshot back
 * (`finalComparison.ts`'s `readHouseholdFinalComparisonWithAdminSdk`) and
 * republishes it verbatim to RTDB via `.update()`. This makes a
 * deduplicated replay (`input.deduplicated === true`, which
 * `transitionPhase.ts` still invokes this hook for) trivially safe: the
 * Firestore doc from the original commit is simply read and re-published,
 * with zero settlement logic or HouseholdState reads/writes re-run.
 *
 * Self-gates like the RUNNING branch (non-HOME_ECONOMICS / non-advanced-
 * format / snapshot missing all no-op) so a Social Studies lesson or a
 * comparison that — defensively — never got written costs at most a
 * couple of extra reads, never a write.
 */
const afterReflectionTransition = async (input: {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  deduplicated: boolean
}): Promise<void> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${input.lessonRunId}`).get()
  if (!runSnap.exists) return
  const run = runSnap.data() as RunSnapshotShape
  if (run.subject !== 'HOME_ECONOMICS') return

  const courseFormat = run.templateSnapshot?.homeEconomics?.courseFormat
  if (!isAdvancedHouseholdCourseFormat(courseFormat)) return

  const comparison = await readHouseholdFinalComparisonWithAdminSdk(input.lessonRunId)
  // Defensive: `prepareReflectionTransition` always writes this in the same
  // transaction as a genuine RUNNING -> REFLECTION transition for an
  // advanced format — a missing snapshot here means this hook is being
  // invoked in a state that should be unreachable through the normal
  // `transitionPhase` state machine. No-op rather than throw, matching this
  // module's other defensive early-returns.
  if (!comparison) return

  const rtdb = getDatabase()
  await rtdb.ref(`lessonRunPublic/${input.lessonRunId}`).update({
    orgId: run.orgId,
    householdClassComparison: comparison,
  })
}
