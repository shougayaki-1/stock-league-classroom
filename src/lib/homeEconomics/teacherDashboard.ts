import { httpsCallable, type Functions } from 'firebase/functions'

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
  courseFormat: 'COMMON_CONDITIONS'
  restoreGeneration: number
  currentRoundIndex: number | null
  householdsAligned: boolean
  updatedAtServerMillis: number
  households: HouseholdTeacherRow[]
  checkpoints: HouseholdCheckpointManifest[]
  activeBulkOperation: HouseholdBulkSettlementOperationView | null
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
