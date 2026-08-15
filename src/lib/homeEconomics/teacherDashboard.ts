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
