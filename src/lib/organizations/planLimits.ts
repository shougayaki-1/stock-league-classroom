import { httpsCallable, type Functions } from 'firebase/functions'

export interface PlanLimits {
  concurrentLessonsAndMarkets: number
  participants: number
  teacherSeats: number
  aiCredits: number
  templateStorage: number
  resultRetentionDays: number
  eventExtraCapacity: number
}

export type LimitKey = 'concurrentLessonsAndMarkets' | 'teacherSeats'

export interface LimitViolation {
  key: LimitKey
  label: string
  used: number
  limit: number
}

export interface DowngradeStatus {
  state: 'SCHEDULED' | 'NORMAL' | 'GRACE' | 'RESTRICTED'
  pendingPlanChange?: { planId: string; effectiveAtMillis: number }
  graceEndsAtMillis?: number
  violations: LimitViolation[]
}

export interface PlanLimitsResult extends PlanLimits {
  downgradeStatus: DowngradeStatus
}

export interface GetOrgPlanLimitsInput { orgId: string }

export const getOrgPlanLimits = async (functions: Functions, input: GetOrgPlanLimitsInput): Promise<PlanLimitsResult> =>
  (await httpsCallable<GetOrgPlanLimitsInput, PlanLimitsResult>(functions, 'getOrgPlanLimitsCallable')(input)).data
