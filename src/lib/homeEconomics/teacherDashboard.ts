import { httpsCallable, type Functions } from 'firebase/functions'

export type CourseFormat = 'COMMON_CONDITIONS' | 'ROLE_VARIANT' | 'STAGE_SPLIT' | 'MULTI_PERSON_PER_TEAM'

export interface HouseholdTeacherWarning {
  severity: 'ACTION_REQUIRED' | 'WARNING' | 'INFO'
  code: string
  message: string
}

export interface HouseholdAssignmentEntryView {
  householdId: string
  profileId: string
  displayOrder: number
  assignmentSource: 'AUTO' | 'MANUAL'
}

export interface HouseholdAssignmentWarning {
  code: string
  message: string
}

export interface HouseholdAssignmentView {
  lessonRunId: string
  courseFormat: CourseFormat
  state: 'UNPREPARED' | 'DRAFT' | 'STALE' | 'FROZEN'
  validationStatus: 'READY' | 'INVALID'
  assignmentRevision: number | null
  warnings: HouseholdAssignmentWarning[]
  teams: Array<{
    teamId: string
    teamDisplayName: string
    entries: HouseholdAssignmentEntryView[]
  }>
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
  warnings: HouseholdTeacherWarning[]
}

export interface HouseholdTeacherTeamRow {
  teamId: string
  teamDisplayName: string
  submittedCount: number
  totalHouseholds: number
  allSubmitted: boolean
  warnings: HouseholdTeacherWarning[]
  households: HouseholdTeacherRow[]
}

export interface HouseholdCheckpointManifest {
  checkpointId: string
  kind: 'MANUAL' | 'PRE_SETTLEMENT' | 'PRE_RESTORE'
  label: string
  expectedRoundIndex: number | null
  createdAtServerMillis: number
  createdByUid: string
  restoreGeneration: number
  /**
   * Which snapshot codec produced this checkpoint — `2` for Common-only,
   * `3` for advanced-format. Mirrors the server-side
   * `HouseholdCheckpointManifest.schemaVersion` (functions/src/homeEconomics/householdCheckpoint.ts),
   * which IS populated for every checkpoint by `listHouseholdCheckpointManifests`
   * (unlike the write/restore call *results*' `schemaVersion`, which Task 7's
   * review flagged as decorative). Optional here only so older
   * tests/fixtures that predate this field keep compiling.
   */
  schemaVersion?: 2 | 3
  /**
   * The `HouseholdAssignmentConfig.assignmentRevision` a v3 checkpoint was
   * taken under. NOT currently populated by any real server response path —
   * the server-side manifest builder does not expose it per-checkpoint yet
   * (only the full v3 snapshot body carries it). Included here so the
   * checkpoint modal's incompatible-restore guard is ready the moment a
   * future server change starts populating it; until then this field is
   * always `undefined` and the guard is a no-op, with the actual safety net
   * remaining `restoreHouseholdCheckpointV3`'s existing server-side rejection.
   */
  assignmentRevision?: number
}

export interface HouseholdBulkSettlementOperationView {
  operationId: string
  lessonRunId: string
  actorUid: string
  expectedRoundIndex: number
  restoreGeneration: number
  forceUnsubmitted: boolean
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  preSettlementCheckpointId: string | null
  attempt: number
  leaseActive: boolean
  retryable: boolean
  households: Record<string, {
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    errorCode?: string
    errorMessage?: string
  }>
  createdAtServerMillis: number
  updatedAtServerMillis: number
}

export interface HouseholdTeacherDashboard {
  lessonRunId: string
  subject: 'HOME_ECONOMICS'
  courseFormat: CourseFormat
  assignment: HouseholdAssignmentView | null
  restoreGeneration: number
  synchronizedRoundIndex: number | null
  roundStatus: 'OPEN' | 'SETTLING' | null
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  teams: HouseholdTeacherTeamRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
  finalComparisonAvailable: boolean
}

export interface GetHouseholdTeacherDashboardInput {
  lessonRunId: string
}

export const getHouseholdTeacherDashboard = async (
  functions: Functions,
  input: GetHouseholdTeacherDashboardInput,
): Promise<HouseholdTeacherDashboard> => {
  const callable = httpsCallable<GetHouseholdTeacherDashboardInput, HouseholdTeacherDashboard>(
    functions,
    'getHouseholdTeacherDashboardCallable',
  )
  const result = await callable(input)
  return result.data
}
