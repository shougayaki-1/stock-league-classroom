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

export interface OrgUsageDashboardDeps {
  countLessonRunsThisMonth: (orgId: string) => Promise<number>
  countLessonRunsTotal: (orgId: string) => Promise<number>
  countActiveLessonRuns: (orgId: string) => Promise<number>
  getLimits: (orgId: string) => Promise<{ concurrentLessonsAndMarkets: number; aiCreditsPerDay: number; aiCredits: number }>
  getAiDailyUsed: (orgId: string) => Promise<number>
  getAiMonthlyUsed: (orgId: string) => Promise<number>
}

export const buildOrgUsageDashboard = async (deps: OrgUsageDashboardDeps, input: { orgId: string }): Promise<OrgUsageDashboard> => {
  const [lessonRunsThisMonth, lessonRunsTotal, concurrentActive, limits, aiDailyUsed, aiMonthlyUsed] = await Promise.all([
    deps.countLessonRunsThisMonth(input.orgId),
    deps.countLessonRunsTotal(input.orgId),
    deps.countActiveLessonRuns(input.orgId),
    deps.getLimits(input.orgId),
    deps.getAiDailyUsed(input.orgId),
    deps.getAiMonthlyUsed(input.orgId),
  ])
  return {
    lessonRunsThisMonth,
    lessonRunsTotal,
    concurrentActive,
    concurrentLimit: limits.concurrentLessonsAndMarkets,
    aiDailyUsed,
    aiDailyLimit: limits.aiCreditsPerDay,
    aiMonthlyUsed,
    aiMonthlyLimit: limits.aiCredits,
  }
}
