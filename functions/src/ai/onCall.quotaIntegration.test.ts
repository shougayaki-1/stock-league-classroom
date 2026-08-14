import { beforeEach, describe, expect, it, vi } from 'vitest'

// Integration-style test: exercises checkAiQuota together with the REAL
// getAiUsageQuotaDepsWithAdminSdk (not a stubbed `() => ({})` as in onCall.test.ts),
// using the same Firestore-mocking approach established in usageQuota.adminSdk.test.ts.
// This proves the deps object the callables build actually round-trips correctly
// through the real quota logic, including the Finding 2 safe-default fallback when
// a real Firestore planDefinitions doc is missing aiCreditsPerDay.

type DocumentData = Record<string, unknown>
const documents = new Map<string, DocumentData>()

const doc = (path: string) => ({
  get: async () => {
    const data = documents.get(path)
    return { exists: data !== undefined, get: (field: string) => data?.[field] }
  },
  set: async (data: DocumentData) => {
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
import { checkAiQuota, AiQuotaExceededError, getAiUsageQuotaDepsWithAdminSdk } from './usageQuota'

const nowMillis = () => Date.parse('2026-01-01T02:00:00Z') // JST 2026-01-01T11:00:00

describe('checkAiQuota with real getAiUsageQuotaDepsWithAdminSdk (Finding 6 integration)', () => {
  beforeEach(() => { documents.clear(); vi.clearAllMocks() })

  it('rejects every call with a DAILY AiQuotaExceededError when the plan-limits doc is missing aiCreditsPerDay (simulating today\'s real production data)', async () => {
    // Simulates a real Firestore planDefinitions document that predates the
    // aiCreditsPerDay field being added to the TypeScript type (Finding 2 scenario).
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValue({
      concurrentLessonsAndMarkets: 1, participants: 1, teacherSeats: 1, aiCredits: 100,
      aiCreditsPerDay: undefined as unknown as number,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)

    // With the Finding 2 fix, a missing aiCreditsPerDay must fail closed (daily
    // limit of 0), not fail open ("no limit"). A dailyCount of 0 is already >= 0,
    // so every call must be rejected with the DAILY quota-exceeded error, not
    // silently allowed through.
    await expect(checkAiQuota(deps, { orgId: 'org-missing-daily-limit' })).rejects.toBeInstanceOf(AiQuotaExceededError)
    await expect(checkAiQuota(deps, { orgId: 'org-missing-daily-limit' })).rejects.toMatchObject({ period: 'DAILY' })
  })

  it('allows calls within a properly-configured daily/monthly limit and blocks once the daily limit is reached', async () => {
    vi.mocked(getOrgPlanLimitsWithAdminSdk).mockResolvedValue({
      concurrentLessonsAndMarkets: 1, participants: 1, teacherSeats: 1, aiCredits: 100, aiCreditsPerDay: 2,
      templateStorage: 1, resultRetentionDays: 1, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL', violations: [] },
    })
    const deps = getAiUsageQuotaDepsWithAdminSdk(nowMillis)
    const orgId = 'org-configured'

    await expect(checkAiQuota(deps, { orgId })).resolves.toBeUndefined()
    await deps.incrementDailyCount(orgId)
    await deps.incrementMonthlyCount(orgId)

    await expect(checkAiQuota(deps, { orgId })).resolves.toBeUndefined()
    await deps.incrementDailyCount(orgId)
    await deps.incrementMonthlyCount(orgId)

    await expect(checkAiQuota(deps, { orgId })).rejects.toMatchObject({ period: 'DAILY' })
  })
})
