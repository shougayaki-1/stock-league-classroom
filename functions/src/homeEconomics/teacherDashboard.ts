import { getFirestore } from 'firebase-admin/firestore'
import type { CourseFormat, HomeEconomicsContent } from '@stock-league/household-authoring-content'
import type { HouseholdDecisionRecord, HouseholdState } from '../lessonRuns/households/repository'
import {
  findUnresolvedBulkSettlementOperationWithAdminSdk,
  toHouseholdBulkSettlementOperationView,
  type HouseholdBulkItemStatus,
  type HouseholdBulkSettlementOperationView,
} from './bulkSettlementOperation'
import {
  listHouseholdCheckpointManifestsWithAdminSdk,
  type HouseholdCheckpointManifest,
} from './householdCheckpoint'
import { previewCommonConditionsHouseholdState, resolveCommonConditionsProfile } from './commonConditionsHousehold'
import { previewAssignedHouseholdState } from './assignedHousehold'
import type { HouseholdRuntimeControl } from './statusTransition'
import {
  getHouseholdAssignmentView,
  householdAssignmentReadDepsWithAdminSdk,
  type HouseholdAssignmentView,
} from './householdAssignmentRepository'

export interface HouseholdTeacherWarning {
  severity: 'ACTION_REQUIRED' | 'WARNING' | 'INFO'
  code: string
  message: string
}

/**
 * One team's household rows plus team-level aggregates. For COMMON_CONDITIONS
 * and the ROLE_VARIANT/STAGE_SPLIT formats a team always has exactly one
 * household (`totalHouseholds === 1`); for MULTI_PERSON_PER_TEAM a team can
 * hold several, and `submittedCount`/`totalHouseholds` is how the teacher
 * sees "x/y households have submitted this round" progress for that team.
 */
export interface HouseholdTeacherTeamRow {
  teamId: string
  teamDisplayName: string
  submittedCount: number
  totalHouseholds: number
  allSubmitted: boolean
  warnings: HouseholdTeacherWarning[]
  households: HouseholdTeacherRow[]
}

export interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: CourseFormat
  /**
   * `null` for COMMON_CONDITIONS, which has no persisted per-team assignment
   * plan (see `householdAssignmentRepository.ts`'s `getHouseholdAssignmentView`
   * doc comment on its "implicit compatibility view" — that view exists for
   * internal reuse by the assignment Callables, but is not meaningful to
   * surface to the teacher dashboard, which has nothing to prepare/edit for
   * Common). Populated with the live (possibly UNPREPARED/DRAFT/STALE/FROZEN)
   * view for the 3 advanced formats.
   */
  assignment: HouseholdAssignmentView | null
  restoreGeneration: number
  /** `null` for COMMON_CONDITIONS, which has no `HouseholdRuntimeControl` document (no per-team assignment to synchronize). */
  synchronizedRoundIndex: number | null
  /** `null` for COMMON_CONDITIONS, for the same reason as `synchronizedRoundIndex`. */
  roundStatus: 'OPEN' | 'SETTLING' | null
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  teams: HouseholdTeacherTeamRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  /** Whether `lessonRuns/{lessonRunId}/householdFinalComparison/result` (Task 12) exists yet. Always `false` until that task ships. */
  finalComparisonAvailable: boolean
}

export interface HouseholdTeacherRow {
  householdId: string
  teamId: string
  teamDisplayName: string
  lifeStage: string
  /**
   * Important I3 fix (whole-branch review): a human-readable label for this
   * household, distinct from the opaque runtime `householdId` above (an
   * `idempotencyDocumentId()` hash — Task 1). Without this, a MULTI team's
   * several household rows in the teacher dashboard were only
   * distinguishable by that hash. `${lifeStage}・${family}` — same pairing
   * and same rationale as the student-facing tab label fix in
   * `HouseholdTeamScreen.tsx` (`family` disambiguates MULTI_PERSON_PER_TEAM,
   * which puts every authored profile on the same team and so can repeat a
   * `lifeStage`; neither field is translated, matching this codebase's
   * existing convention of rendering `lifeStage`'s raw enum string
   * elsewhere). `family` is looked up from the template snapshot's
   * `HomeEconomicsContent.households` by `state.profileId` — falls back to
   * `lifeStage` alone if the profile is somehow not found (defensive; should
   * not happen given `profileId` is validated against the template at
   * freeze/lazy-init time).
   */
  profileLabel: string
  roundIndex: number
  submittedForRoundIndex: boolean
  submittedAtServerMillis: number | null
  lastSettledRoundIndex: number | null
  cashYen: number
  assetHoldingsYen: Record<string, number>
  totalAssetsYen: number
  activeInsuranceContracts: Record<string, number>
  activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number }>
  lastSettlementSummary: {
    roundIndex: number
    incomeYen: number
    expensesYen: number
    netCashFlowYen: number
    shortfallYen: number
    insuranceBenefitsYen: number
  } | null
  goalDelayedRounds: number
  revealedEvents: Array<{ eventId: string; label: string | null; effectDescription: string | null }>
  warnings: HouseholdTeacherWarning[]
}

export const normalizeTeamDisplayName = (teamId: string, data: Record<string, unknown>): string => {
  const value = data.displayName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : teamId
}

export interface RoundSettledEventPayload {
  householdId: string
  roundIndex: number
  occurredEventIds: string[]
  incomeYen: number
  expensesYen: number
  netCashFlowYen: number
  shortfallYen: number
  insuranceBenefitsYen: number
  forcedSettlement?: boolean
}

export interface BuildHouseholdTeacherRowInput {
  teamId: string
  teamDisplayName: string
  state: HouseholdState
  content: HomeEconomicsContent
  decision: HouseholdDecisionRecord | null
  lastSettlementEventPayload: RoundSettledEventPayload | null
  bulkItemStatus: { status: HouseholdBulkItemStatus; errorCode?: string; errorMessage?: string } | null
  restoreGeneration: number
}

export const buildHouseholdTeacherRow = (
  input: BuildHouseholdTeacherRowInput,
): HouseholdTeacherRow => {
  const { state, content, decision, lastSettlementEventPayload, bulkItemStatus } = input

  const totalAssetsYen = Object.values(state.assetHoldingsYen).reduce((sum, val) => sum + val, 0)
  const authoredProfile = content.households.find((profile) => profile.householdId === state.profileId)
  const profileLabel = authoredProfile ? `${state.lifeStage}・${authoredProfile.family}` : state.lifeStage
  const submittedForRoundIndex = decision !== null && decision.roundIndex === state.roundIndex
  const submittedAtServerMillis = submittedForRoundIndex ? decision.submittedAtServerMillis : null
  const lastSettledRoundIndex = lastSettlementEventPayload?.roundIndex ?? null

  const lastSettlementSummary = lastSettlementEventPayload
    ? {
        roundIndex: lastSettlementEventPayload.roundIndex,
        incomeYen: lastSettlementEventPayload.incomeYen,
        expensesYen: lastSettlementEventPayload.expensesYen,
        netCashFlowYen: lastSettlementEventPayload.netCashFlowYen,
        shortfallYen: lastSettlementEventPayload.shortfallYen,
        insuranceBenefitsYen: lastSettlementEventPayload.insuranceBenefitsYen,
      }
    : null

  const activeLiabilities: Record<string, { remainingPrincipalYen: number; remainingYears: number }> = {}
  for (const [id, liab] of Object.entries(state.activeLiabilities)) {
    activeLiabilities[id] = {
      remainingPrincipalYen: liab.remainingPrincipalYen,
      remainingYears: liab.remainingYears,
    }
  }

  const revealedEvents: Array<{ eventId: string; label: string | null; effectDescription: string | null }> = []
  if (lastSettlementEventPayload?.occurredEventIds) {
    for (const eventId of lastSettlementEventPayload.occurredEventIds) {
      const ev = content.lifeEvents.find((e) => e.id === eventId)
      revealedEvents.push({
        eventId,
        label: ev?.label ?? null,
        effectDescription: ev?.effectDescription ?? null,
      })
    }
  }

  const warnings: HouseholdTeacherRow['warnings'] = []
  if (!submittedForRoundIndex) {
    warnings.push({
      severity: 'ACTION_REQUIRED',
      code: 'UNSUBMITTED_DECISION',
      message: '現在のラウンドの意思決定が未提出です',
    })
  }

  if (bulkItemStatus && bulkItemStatus.status === 'FAILED') {
    warnings.push({
      severity: 'ACTION_REQUIRED',
      code: 'BULK_SETTLEMENT_FAILED',
      message: bulkItemStatus.errorMessage || '一括決算でエラーが発生しました',
    })
  }

  if (lastSettlementSummary && lastSettlementSummary.shortfallYen > 0) {
    warnings.push({
      severity: 'WARNING',
      code: 'SHORTFALL_OCCURRED',
      message: `直近決算で${lastSettlementSummary.shortfallYen.toLocaleString()}円の資金不足が発生しました`,
    })
  }

  if (state.goalDelayedRounds > 0) {
    warnings.push({
      severity: 'WARNING',
      code: 'GOAL_DELAYED',
      message: `目標達成が${state.goalDelayedRounds}回延期されています`,
    })
  }

  if (state.cashYen < 0) {
    warnings.push({
      severity: 'WARNING',
      code: 'NEGATIVE_CASH',
      message: '現金残高がマイナスになっています',
    })
  }

  if (input.restoreGeneration > 0) {
    warnings.push({
      severity: 'INFO',
      code: 'RESTORED_GENERATION',
      message: `チェックポイント復元が行われました（第${input.restoreGeneration}世代）`,
    })
  }

  return {
    householdId: state.householdId,
    teamId: input.teamId,
    teamDisplayName: input.teamDisplayName,
    lifeStage: state.lifeStage,
    profileLabel,
    roundIndex: state.roundIndex,
    submittedForRoundIndex,
    submittedAtServerMillis,
    lastSettledRoundIndex,
    cashYen: state.cashYen,
    assetHoldingsYen: { ...state.assetHoldingsYen },
    totalAssetsYen,
    activeInsuranceContracts: { ...state.activeInsuranceContracts },
    activeLiabilities,
    lastSettlementSummary,
    goalDelayedRounds: state.goalDelayedRounds,
    revealedEvents,
    warnings,
  }
}

/**
 * `ROUND_MISALIGNED` used to be a per-household, always-`INFO` warning
 * (Common-only, since Common is the only format where households naturally
 * drift apart — each team settles independently, so "everyone's on a
 * different round" is ordinary, low-stakes async progress). The 3 advanced
 * formats introduce `HouseholdRuntimeControl.roundStatus`, which changes
 * what misalignment MEANS:
 *
 * - `roundStatus === 'SETTLING'`: a bulk settlement is actively in flight —
 *   some households have already been advanced to `N+1` while others are
 *   still at `N`. This is an expected, temporary, self-resolving state, so
 *   it stays `INFO`.
 * - `roundStatus === 'OPEN'`: no bulk settlement is running, yet households
 *   are still misaligned. For an advanced format this should never persist
 *   outside of an active settlement — it signals a partial/interrupted bulk
 *   operation that never finished, and needs teacher attention. `ACTION_REQUIRED`.
 * - `roundStatus === null` (COMMON_CONDITIONS, which has no control
 *   document): preserves the original always-`INFO` behavior — Common's
 *   async, per-team settlement makes misalignment ordinary, not a fault.
 *
 * Lifted to team level (not per-household) because it's a GLOBAL condition
 * (computed once from the dashboard-wide `householdsAligned`), and the new
 * `HouseholdTeacherTeamRow.warnings` field is where team-scoped/global
 * conditions belong per the brief's shape — attaching the identical warning
 * object to every team's row is the direct successor of the old
 * "attach to every household row" behavior, one level up.
 */
export const computeRoundMisalignmentWarning = (
  householdsAligned: boolean,
  roundStatus: 'OPEN' | 'SETTLING' | null,
): HouseholdTeacherWarning | null => {
  if (householdsAligned) return null
  if (roundStatus === 'OPEN') {
    return {
      severity: 'ACTION_REQUIRED',
      code: 'ROUND_MISALIGNED',
      message: '家庭間で進行ラウンドが異なっていますが、一括決算は実行中ではありません。決算が中断された可能性があります。',
    }
  }
  return {
    severity: 'INFO',
    code: 'ROUND_MISALIGNED',
    message: '家庭間で進行ラウンドが異なっています',
  }
}

export interface BuildHouseholdTeacherDashboardInput {
  lessonRunId: string
  courseFormat: CourseFormat
  assignment: HouseholdAssignmentView | null
  restoreGeneration: number
  synchronizedRoundIndex: number | null
  roundStatus: 'OPEN' | 'SETTLING' | null
  content: HomeEconomicsContent
  teams: Array<{ teamId: string; displayName: string }>
  /** Keyed by RUNTIME householdId (== teamId for COMMON_CONDITIONS). */
  householdStates: Record<string, HouseholdState>
  /** Keyed by RUNTIME householdId. */
  decisions: Record<string, HouseholdDecisionRecord | null>
  /** Keyed by RUNTIME householdId. */
  lastSettlementEvents: Record<string, RoundSettledEventPayload | null>
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  finalComparisonAvailable: boolean
  nowMillis: number
}

export const buildHouseholdTeacherDashboard = (
  input: BuildHouseholdTeacherDashboardInput,
): HouseholdTeacherDashboard => {
  const states = Object.values(input.householdStates)
  const roundIndices = new Set(states.map((s) => s.roundIndex))
  const householdsAligned = roundIndices.size <= 1
  const currentRoundIndex = householdsAligned && states.length > 0 ? states[0].roundIndex : null

  const misalignmentWarning = computeRoundMisalignmentWarning(householdsAligned, input.roundStatus)

  // Group runtime households by their own `teamId` (carried on every
  // `HouseholdState`) rather than requiring a separate teamId->householdIds
  // map from the caller — this is what lets a single loop below serve
  // COMMON_CONDITIONS (1 household per team) and the 3 advanced formats
  // (1..N households per team) identically.
  const householdIdsByTeam = new Map<string, string[]>()
  for (const state of states) {
    const list = householdIdsByTeam.get(state.teamId)
    if (list) list.push(state.householdId)
    else householdIdsByTeam.set(state.teamId, [state.householdId])
  }

  const sortedTeams = [...input.teams].sort((a, b) => a.teamId.localeCompare(b.teamId))
  const teamRows: HouseholdTeacherTeamRow[] = []

  for (const team of sortedTeams) {
    const householdIds = [...(householdIdsByTeam.get(team.teamId) ?? [])].sort()
    if (householdIds.length === 0) continue

    const rows: HouseholdTeacherRow[] = householdIds.map((householdId) => {
      const state = input.householdStates[householdId]
      const decision = input.decisions[householdId] ?? null
      const lastSettlementEventPayload = input.lastSettlementEvents[householdId] ?? null
      const bulkItemStatus = input.activeBulkOperation?.households[householdId] ?? null

      return buildHouseholdTeacherRow({
        teamId: team.teamId,
        teamDisplayName: team.displayName,
        state,
        content: input.content,
        decision,
        lastSettlementEventPayload,
        bulkItemStatus,
        restoreGeneration: input.restoreGeneration,
      })
    })

    const submittedCount = rows.filter((row) => row.submittedForRoundIndex).length
    const totalHouseholds = rows.length

    teamRows.push({
      teamId: team.teamId,
      teamDisplayName: team.displayName,
      submittedCount,
      totalHouseholds,
      allSubmitted: submittedCount === totalHouseholds,
      warnings: misalignmentWarning ? [misalignmentWarning] : [],
      households: rows,
    })
  }

  return {
    lessonRunId: input.lessonRunId,
    subject: 'HOME_ECONOMICS',
    courseFormat: input.courseFormat,
    assignment: input.assignment,
    restoreGeneration: input.restoreGeneration,
    synchronizedRoundIndex: input.synchronizedRoundIndex,
    roundStatus: input.roundStatus,
    currentRoundIndex,
    householdsAligned,
    updatedAtServerMillis: input.nowMillis,
    teams: teamRows,
    checkpoints: input.checkpoints,
    activeBulkOperation: input.activeBulkOperation,
    finalComparisonAvailable: input.finalComparisonAvailable,
  }
}

export const loadHouseholdTeacherDashboardWithAdminSdk = async (
  lessonRunId: string,
  nowMillis: number,
): Promise<HouseholdTeacherDashboard> => {
  const db = getFirestore()
  const runSnap = await db.doc(`lessonRuns/${lessonRunId}`).get()
  if (!runSnap.exists) throw new Error('LessonRun not found')
  const runData = runSnap.data() as {
    subject?: string
    restoreGeneration?: number
    templateSnapshot?: { homeEconomics?: HomeEconomicsContent }
  }

  if (runData.subject !== 'HOME_ECONOMICS') {
    throw new Error('LessonRun subject is not HOME_ECONOMICS')
  }

  const content = runData.templateSnapshot?.homeEconomics
  if (!content) {
    throw new Error('LessonRun has no homeEconomics content')
  }

  const courseFormat = content.courseFormat
  const restoreGeneration = typeof runData.restoreGeneration === 'number' ? runData.restoreGeneration : 0

  // 1. Teams
  const teamsSnap = await db.collection(`lessonRuns/${lessonRunId}/teams`).get()
  const teams: Array<{ teamId: string; displayName: string }> = []
  for (const doc of teamsSnap.docs) {
    teams.push({
      teamId: doc.id,
      displayName: normalizeTeamDisplayName(doc.id, doc.data()),
    })
  }
  const teamIds = teams.map((team) => team.teamId)
  const teamDisplayNames: Record<string, string> = {}
  for (const team of teams) teamDisplayNames[team.teamId] = team.displayName

  // 2. Resolve which runtime households exist per team (and which profile
  // each one plays), via the compatibility/frozen assignment view (Task 2):
  // COMMON_CONDITIONS has no persisted assignment (householdId === teamId,
  // single shared profile); the 3 advanced formats read the live
  // (possibly UNPREPARED/DRAFT/STALE/FROZEN) assignment view, which is
  // exactly right BEFORE RUNNING too — an UNPREPARED/DRAFT view still
  // reports the entries the teacher would get if they prepared/froze now,
  // letting the dashboard preview without requiring the lesson to have
  // started.
  const commonProfile = courseFormat === 'COMMON_CONDITIONS' ? resolveCommonConditionsProfile(content) : undefined
  const assignmentView = courseFormat === 'COMMON_CONDITIONS'
    ? null
    : await getHouseholdAssignmentView({
      lessonRunId,
      courseFormat,
      currentTeamIds: teamIds,
      teamDisplayNames,
      profiles: content.households,
      deps: householdAssignmentReadDepsWithAdminSdk(),
    })

  const householdEntries: Array<{ householdId: string; teamId: string; profileId: string }> = []
  if (courseFormat === 'COMMON_CONDITIONS') {
    for (const team of teams) {
      householdEntries.push({ householdId: team.teamId, teamId: team.teamId, profileId: commonProfile!.householdId })
    }
  } else {
    for (const team of assignmentView!.teams) {
      for (const entry of team.entries) {
        householdEntries.push({ householdId: entry.householdId, teamId: team.teamId, profileId: entry.profileId })
      }
    }
  }

  // 3. Household states (preview if missing, do not persist — a preview
  // for the 3 advanced formats never calls `ensureAssignedHouseholdStateWithAdminSdk`,
  // which requires a FROZEN assignment and writes real Firestore documents;
  // it uses the pure `previewAssignedHouseholdState`, mirroring Common's own
  // `previewCommonConditionsHouseholdState`).
  const profileById = new Map(content.households.map((profile) => [profile.householdId, profile] as const))
  const householdStates: Record<string, HouseholdState> = {}
  for (const entry of householdEntries) {
    const hSnap = await db.doc(`lessonRuns/${lessonRunId}/households/${entry.householdId}`).get()
    if (hSnap.exists) {
      householdStates[entry.householdId] = hSnap.data() as unknown as HouseholdState
      continue
    }
    if (courseFormat === 'COMMON_CONDITIONS') {
      householdStates[entry.householdId] = previewCommonConditionsHouseholdState({
        lessonRunId,
        teamId: entry.teamId,
        content,
        nowMillis,
      })
      continue
    }
    const profile = profileById.get(entry.profileId)
    // Should not happen: the assignment view only ever contains entries
    // whose profileId resolved against the template snapshot at prepare
    // time. Skip defensively rather than throwing, so one stale entry can't
    // take down the whole dashboard.
    if (!profile) continue
    householdStates[entry.householdId] = previewAssignedHouseholdState({
      lessonRunId,
      householdId: entry.householdId,
      teamId: entry.teamId,
      profile,
      nowMillis,
    })
  }

  // 4. Latest decisions for current roundIndex, per runtime household
  const decisions: Record<string, HouseholdDecisionRecord | null> = {}
  for (const entry of householdEntries) {
    const state = householdStates[entry.householdId]
    if (!state) continue
    const decSnap = await db
      .collection(`lessonRuns/${lessonRunId}/households/${entry.householdId}/decisions`)
      .where('roundIndex', '==', state.roundIndex)
      .get()

    if (!decSnap.empty) {
      const records = decSnap.docs.map((d) => d.data() as unknown as HouseholdDecisionRecord)
      records.sort((a, b) => b.submittedAtServerMillis - a.submittedAtServerMillis)
      decisions[entry.householdId] = records[0]
    } else {
      decisions[entry.householdId] = null
    }
  }

  // 5. Latest ROUND_SETTLED event for each household
  const eventsSnap = await db
    .collection(`lessonRuns/${lessonRunId}/events`)
    .where('type', '==', 'ROUND_SETTLED')
    .get()

  const lastSettlementEvents: Record<string, RoundSettledEventPayload | null> = {}
  for (const doc of eventsSnap.docs) {
    const data = doc.data()
    const payload = data.payload as RoundSettledEventPayload | undefined
    if (payload?.householdId) {
      const prior = lastSettlementEvents[payload.householdId]
      if (!prior || payload.roundIndex > prior.roundIndex) {
        lastSettlementEvents[payload.householdId] = payload
      }
    }
  }

  // 6. Checkpoints
  const checkpoints = await listHouseholdCheckpointManifestsWithAdminSdk(lessonRunId)

  // 7. Active/unresolved bulk operation
  const unresolvedOp = await findUnresolvedBulkSettlementOperationWithAdminSdk(lessonRunId)
  const activeBulkOperation = unresolvedOp ? toHouseholdBulkSettlementOperationView(unresolvedOp, nowMillis) : null

  // 8. Runtime control (synchronizedRoundIndex/roundStatus) — advanced formats only.
  let synchronizedRoundIndex: number | null = null
  let roundStatus: 'OPEN' | 'SETTLING' | null = null
  if (courseFormat !== 'COMMON_CONDITIONS') {
    const controlSnap = await db.doc(`lessonRuns/${lessonRunId}/householdRuntime/control`).get()
    if (controlSnap.exists) {
      const control = controlSnap.data() as unknown as HouseholdRuntimeControl
      synchronizedRoundIndex = control.synchronizedRoundIndex
      roundStatus = control.roundStatus
    }
  }

  // 9. Final comparison availability (Task 12 — existence check only).
  const finalComparisonSnap = await db.doc(`lessonRuns/${lessonRunId}/householdFinalComparison/result`).get()
  const finalComparisonAvailable = finalComparisonSnap.exists

  return buildHouseholdTeacherDashboard({
    lessonRunId,
    courseFormat,
    assignment: assignmentView,
    restoreGeneration,
    synchronizedRoundIndex,
    roundStatus,
    content,
    teams,
    householdStates,
    decisions,
    lastSettlementEvents,
    checkpoints,
    activeBulkOperation,
    finalComparisonAvailable,
    nowMillis,
  })
}
