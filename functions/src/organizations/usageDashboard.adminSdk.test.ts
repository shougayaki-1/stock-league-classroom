import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const collectionQueries: Array<{ path: string; wheres: unknown[][] }> = []
const queryResults = new Map<string, DocumentData[]>()

const buildQuery = (path: string, wheres: unknown[][]) => ({
  where: (...args: unknown[]) => buildQuery(path, [...wheres, args]),
  get: async () => {
    collectionQueries.push({ path, wheres })
    return { size: (queryResults.get(path) ?? []).length, docs: (queryResults.get(path) ?? []).map((data) => ({ data: () => data })) }
  },
})

const doc = (path: string) => ({
  get: async () => (documents.has(path) ? { exists: true, get: (field: string) => documents.get(path)?.[field] } : { exists: false, get: () => undefined }),
})

const collection = (path: string) => buildQuery(path, [])

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc, collection }) }))
vi.mock('./planLimits', () => ({
  ACTIVE_LESSON_RUN_STATUSES: ['DRAFT', 'READY', 'WAITING', 'RUNNING', 'PAUSED', 'INTERRUPTED', 'REFLECTION'],
  getOrgPlanLimitsWithAdminSdk: vi.fn(),
}))

import { getOrgPlanLimitsWithAdminSdk } from './planLimits'
import { getOrgUsageDashboardWithAdminSdk } from './usageDashboard'

const nowMillis = () => Date.parse('2026-08-15T02:00:00Z') // JST 2026-08-15T11:00:00

describe('getOrgUsageDashboardWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); collectionQueries.length = 0; queryResults.clear(); vi.clearAllMocks() })

  it('assembles counts and limits for the given org', async () => {
    queryResults.set('lessonRuns', [{}, {}, {}])
    documents.set('organizations/org-1/aiUsageCounters/2026-08-15', { count: 4 })
    documents.set('organizations/org-1/aiUsageCounters/2026-08', { count: 30 })
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 5, participants: 1, teacherSeats: 1, aiCredits: 100, aiCreditsPerDay: 10,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })

    const result = await getOrgUsageDashboardWithAdminSdk('org-1', nowMillis)

    expect(result).toEqual({
      lessonRunsThisMonth: 3,
      lessonRunsTotal: 3,
      concurrentActive: 3,
      concurrentLimit: 5,
      aiDailyUsed: 4,
      aiDailyLimit: 10,
      aiMonthlyUsed: 30,
      aiMonthlyLimit: 100,
    })
    expect(collectionQueries.filter((q) => q.path === 'lessonRuns')).toHaveLength(3)
  })

  it('propagates a missing-plan error from getOrgPlanLimitsWithAdminSdk', async () => {
    queryResults.set('lessonRuns', [])
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockRejectedValueOnce(new Error('この組織にはプランが設定されていません'))
    await expect(getOrgUsageDashboardWithAdminSdk('org-1', nowMillis)).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
