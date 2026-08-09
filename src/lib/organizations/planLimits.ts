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

export interface GetOrgPlanLimitsInput { orgId: string }

export const getOrgPlanLimits = async (functions: Functions, input: GetOrgPlanLimitsInput): Promise<PlanLimits> =>
  (await httpsCallable<GetOrgPlanLimitsInput, PlanLimits>(functions, 'getOrgPlanLimitsCallable')(input)).data
