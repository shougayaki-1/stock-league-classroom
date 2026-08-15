import { getFirestore } from 'firebase-admin/firestore'
import { ACTIVE_LESSON_RUN_STATUSES, getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { dailyKey, monthlyKey, readAiUsageCount } from '../ai/usageQuota'

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

const jstMonthStartFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' })

/** JST基準の今月初(00:00)のUTCミリ秒。 */
const jstMonthStartMillis = (nowMillisValue: number): number => {
  const [year, month] = jstMonthStartFormatter.format(new Date(nowMillisValue)).split('-').map(Number)
  return Date.parse(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`)
}

/** Production wiring: Firestore Admin SDK。 */
export const getOrgUsageDashboardWithAdminSdk = (orgId: string, nowMillis: () => number = Date.now): Promise<OrgUsageDashboard> => {
  const db = getFirestore()
  const lessonRuns = db.collection('lessonRuns')
  return buildOrgUsageDashboard({
    countLessonRunsTotal: async (id) => (await lessonRuns.where('orgId', '==', id).get()).size,
    countLessonRunsThisMonth: async (id) => {
      const monthStart = jstMonthStartMillis(nowMillis())
      return (await lessonRuns.where('orgId', '==', id).where('createdAt', '>=', new Date(monthStart)).get()).size
    },
    countActiveLessonRuns: async (id) => (await lessonRuns.where('orgId', '==', id).where('status', 'in', ACTIVE_LESSON_RUN_STATUSES).get()).size,
    getLimits: async (id) => {
      const limits = await getOrgPlanLimitsWithAdminSdk(id)
      return { concurrentLessonsAndMarkets: limits.concurrentLessonsAndMarkets, aiCreditsPerDay: limits.aiCreditsPerDay, aiCredits: limits.aiCredits }
    },
    getAiDailyUsed: (id) => readAiUsageCount(db, id, dailyKey(nowMillis())),
    getAiMonthlyUsed: (id) => readAiUsageCount(db, id, monthlyKey(nowMillis())),
  }, { orgId })
}
