import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgUsageDashboard {
  lessonRunsThisMonth: number
  lessonRunsTotal: number
  concurrentActive: number
  concurrentLimit: number
  aiDailyUsed: number
  aiDailyLimit: number
  aiMonthlyUsed: number
  aiMonthlyLimit: number
}

export interface GetOrgUsageDashboardInput { orgId: string }

export const getOrgUsageDashboard = async (functions: Functions, input: GetOrgUsageDashboardInput): Promise<OrgUsageDashboard> =>
  (await httpsCallable<GetOrgUsageDashboardInput, OrgUsageDashboard>(functions, 'getOrgUsageDashboardCallable')(input)).data
