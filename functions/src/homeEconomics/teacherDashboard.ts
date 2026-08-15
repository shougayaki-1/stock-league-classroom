import { getFirestore } from 'firebase-admin/firestore'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
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
import { previewCommonConditionsHouseholdState } from './commonConditionsHousehold'

export interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: 'COMMON_CONDITIONS'
  restoreGeneration: number
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  households: HouseholdTeacherRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
}

export interface HouseholdTeacherRow {
  householdId: string
  teamId: string
  teamDisplayName: string
  lifeStage: string
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
  warnings: Array<{
    severity: 'ACTION_REQUIRED' | 'WARNING' | 'INFO'
    code: string
    message: string
  }>
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
  householdsAligned: boolean
  restoreGeneration: number
}

export const buildHouseholdTeacherRow = (
  input: BuildHouseholdTeacherRowInput,
): HouseholdTeacherRow => {
  const { state, content, decision, lastSettlementEventPayload, bulkItemStatus } = input

  const totalAssetsYen = Object.values(state.assetHoldingsYen).reduce((sum, val) => sum + val, 0)
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

  if (!input.householdsAligned) {
    warnings.push({
      severity: 'INFO',
      code: 'ROUND_MISALIGNED',
      message: '家庭間で進行ラウンドが異なっています',
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

export interface BuildHouseholdTeacherDashboardInput {
  lessonRunId: string
  restoreGeneration: number
  content: HomeEconomicsContent
  teams: Array<{ teamId: string; displayName: string }>
  householdStates: Record<string, HouseholdState>
  decisions: Record<string, HouseholdDecisionRecord | null>
  lastSettlementEvents: Record<string, RoundSettledEventPayload | null>
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  nowMillis: number
}

export const buildHouseholdTeacherDashboard = (
  input: BuildHouseholdTeacherDashboardInput,
): HouseholdTeacherDashboard => {
  const roundIndices = new Set(Object.values(input.householdStates).map((s) => s.roundIndex))
  const householdsAligned = roundIndices.size <= 1
  const currentRoundIndex = householdsAligned && input.teams.length > 0
    ? (input.householdStates[input.teams[0].teamId]?.roundIndex ?? 0)
    : null

  const rows: HouseholdTeacherRow[] = []
  const sortedTeams = [...input.teams].sort((a, b) => a.teamId.localeCompare(b.teamId))

  for (const team of sortedTeams) {
    const state = input.householdStates[team.teamId]
    if (!state) continue
    const decision = input.decisions[team.teamId] ?? null
    const lastSettlementEventPayload = input.lastSettlementEvents[team.teamId] ?? null
    const bulkItemStatus = input.activeBulkOperation?.households[team.teamId] ?? null

    const row = buildHouseholdTeacherRow({
      teamId: team.teamId,
      teamDisplayName: team.displayName,
      state,
      content: input.content,
      decision,
      lastSettlementEventPayload,
      bulkItemStatus,
      householdsAligned,
      restoreGeneration: input.restoreGeneration,
    })
    rows.push(row)
  }

  return {
    lessonRunId: input.lessonRunId,
    subject: 'HOME_ECONOMICS',
    courseFormat: 'COMMON_CONDITIONS',
    restoreGeneration: input.restoreGeneration,
    currentRoundIndex,
    householdsAligned,
    updatedAtServerMillis: input.nowMillis,
    households: rows,
    checkpoints: input.checkpoints,
    activeBulkOperation: input.activeBulkOperation,
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
  if (!content || content.courseFormat !== 'COMMON_CONDITIONS') {
    throw new Error('LessonRun course format must be COMMON_CONDITIONS')
  }

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

  // 2. Household states (preview if missing, do not persist)
  const householdStates: Record<string, HouseholdState> = {}
  for (const team of teams) {
    const hSnap = await db.doc(`lessonRuns/${lessonRunId}/households/${team.teamId}`).get()
    if (hSnap.exists) {
      householdStates[team.teamId] = hSnap.data() as unknown as HouseholdState
    } else {
      householdStates[team.teamId] = previewCommonConditionsHouseholdState({
        lessonRunId,
        teamId: team.teamId,
        content,
        nowMillis,
      })
    }
  }

  // 3. Latest decisions for current roundIndex
  const decisions: Record<string, HouseholdDecisionRecord | null> = {}
  for (const team of teams) {
    const roundIndex = householdStates[team.teamId].roundIndex
    const decSnap = await db
      .collection(`lessonRuns/${lessonRunId}/households/${team.teamId}/decisions`)
      .where('roundIndex', '==', roundIndex)
      .get()

    if (!decSnap.empty) {
      const records = decSnap.docs.map((d) => d.data() as unknown as HouseholdDecisionRecord)
      records.sort((a, b) => b.submittedAtServerMillis - a.submittedAtServerMillis)
      decisions[team.teamId] = records[0]
    } else {
      decisions[team.teamId] = null
    }
  }

  // 4. Latest ROUND_SETTLED event for each household
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

  // 5. Checkpoints
  const checkpoints = await listHouseholdCheckpointManifestsWithAdminSdk(lessonRunId)

  // 6. Active/unresolved bulk operation
  const unresolvedOp = await findUnresolvedBulkSettlementOperationWithAdminSdk(lessonRunId)
  const activeBulkOperation = unresolvedOp ? toHouseholdBulkSettlementOperationView(unresolvedOp, nowMillis) : null

  return buildHouseholdTeacherDashboard({
    lessonRunId,
    restoreGeneration,
    content,
    teams,
    householdStates,
    decisions,
    lastSettlementEvents,
    checkpoints,
    activeBulkOperation,
    nowMillis,
  })
}
