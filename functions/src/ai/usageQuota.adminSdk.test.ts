import { beforeEach, describe, expect, it, vi } from 'vitest'

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()
const setCalls: Array<{ path: string; data: DocumentData }> = []

const doc = (path: string) => ({
  get: async () => {
    const data = documents.get(path)
    return { exists: data !== undefined, get: (field: string) => data?.[field] }
  },
  set: async (data: DocumentData) => {
    setCalls.push({ path, data })
    const existing = documents.get(path) ?? {}
    const merged = { ...existing }
    for (const [key, value] of Object.entries(data)) {
      merged[key] = value === INCREMENT_MARKER ? ((existing[key] as number | undefined) ?? 0) + 1 : value
    }
    documents.set(path, merged)
  },
})

const INCREMENT_MARKER = Symbol('increment')

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: () => INCREMENT_MARKER },
  getFirestore: () => ({ doc }),
}))

vi.mock('../organizations/planLimits', () => ({ getOrgPlanLimitsWithAdminSdk: vi.fn() }))

import { getOrgPlanLimitsWithAdminSdk } from '../organizations/planLimits'
import { getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'

const nowMillis = () => Date.parse('2026-01-01T02:00:00Z') // JST 2026-01-01T11:00:00

describe('getAiUsageQuotaDepsWithAdminSdk', () => {
  beforeEach(() => { documents.clear(); setCalls.length = 0; vi.clearAllMocks() })

  it('reports the kill switch as disabled when the config document does not exist', async () => {
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.isKillSwitchEnabled()).resolves.toBe(false)
  })

  it('reports the kill switch as enabled when the config document says so', async () => {
    documents.set('systemConfig/aiKillSwitch', { enabled: true })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.isKillSwitchEnabled()).resolves.toBe(true)
  })

  it('reads daily and monthly limits from the org plan limits', async () => {
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 1, teacherSeats: 1, aiCredits: 100, aiCreditsPerDay: 10,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.getLimits('org-1')).resolves.toEqual({ daily: 10, monthly: 100 })
  })

  it('falls back to a daily limit of 0 (fail-closed) when aiCreditsPerDay is missing from the plan-limits doc', async () => {
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValueOnce({
      concurrentLessonsAndMarkets: 1, participants: 1, teacherSeats: 1, aiCredits: 100,
      aiCreditsPerDay: undefined as unknown as number,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.getLimits('org-1')).resolves.toEqual({ daily: 0, monthly: 100 })
  })

  it('returns 0 counts when no counter document exists yet, then increments them', async () => {
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    await expect(deps.getDailyCount('org-1')).resolves.toBe(0)
    await expect(deps.getMonthlyCount('org-1')).resolves.toBe(0)

    await deps.incrementDailyCount('org-1')
    await deps.incrementMonthlyCount('org-1')

    await expect(deps.getDailyCount('org-1')).resolves.toBe(1)
    await expect(deps.getMonthlyCount('org-1')).resolves.toBe(1)
    expect(setCalls.map((c) => c.path)).toEqual([
      'organizations/org-1/aiUsageCounters/2026-01-01',
      'organizations/org-1/aiUsageCounters/2026-01',
    ])
  })
})
