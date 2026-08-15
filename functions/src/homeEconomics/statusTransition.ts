import type { HouseholdProfile } from '@stock-league/household-authoring-content'
import type { LifeStage } from '@stock-league/household-public-content'
import type { FirestoreTx } from '../lessonRuns/phases/transitionPhase'
import type { LessonRunStatus } from '../lessonRuns/phases/stateMachine'
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
  templateSnapshot?: {
    homeEconomics?: {
      courseFormat?: string
      households?: HouseholdProfile[]
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
 * Post-commit hook. This task only needs it to exist and be wired so that
 * `transitionPhase.ts`'s call site is exercised end-to-end (and so a
 * deduplicated replay still invokes it, per the brief) — real post-commit
 * work (publishing an RTDB projection of the frozen assignment / initial
 * `HouseholdRuntimeControl` so clients see the freeze without polling
 * Firestore) belongs to a later task (spec'd as Task 9) once that
 * projection shape exists. Deliberately a no-op here rather than a partial
 * implementation of that projection.
 */
export const afterStatusTransition = async (_input: {
  lessonRunId: string
  targetStatus?: LessonRunStatus
  deduplicated: boolean
}): Promise<void> => {
  // Intentionally empty — see doc comment above.
}
