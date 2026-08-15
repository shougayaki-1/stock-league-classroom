import { describe, expect, it, vi } from 'vitest'
import { buildOrgUsageDashboard, type OrgUsageDashboardDeps } from './usageDashboard'

const makeDeps = (overrides: Partial<OrgUsageDashboardDeps> = {}): OrgUsageDashboardDeps => ({
  countLessonRunsThisMonth: vi.fn().mockResolvedValue(3),
  countLessonRunsTotal: vi.fn().mockResolvedValue(42),
  countActiveLessonRuns: vi.fn().mockResolvedValue(2),
  getLimits: vi.fn().mockResolvedValue({ concurrentLessonsAndMarkets: 5, aiCreditsPerDay: 10, aiCredits: 100 }),
  getAiDailyUsed: vi.fn().mockResolvedValue(4),
  getAiMonthlyUsed: vi.fn().mockResolvedValue(30),
  ...overrides,
})

describe('buildOrgUsageDashboard', () => {
  it('assembles all fields from the injected deps', async () => {
    const deps = makeDeps()
    await expect(buildOrgUsageDashboard(deps, { orgId: 'org-1' })).resolves.toEqual({
      lessonRunsThisMonth: 3,
      lessonRunsTotal: 42,
      concurrentActive: 2,
      concurrentLimit: 5,
      aiDailyUsed: 4,
      aiDailyLimit: 10,
      aiMonthlyUsed: 30,
      aiMonthlyLimit: 100,
    })
  })

  it('calls every dep with the given orgId', async () => {
    const deps = makeDeps()
    await buildOrgUsageDashboard(deps, { orgId: 'org-9' })
    expect(deps.countLessonRunsThisMonth).toHaveBeenCalledWith('org-9')
    expect(deps.countLessonRunsTotal).toHaveBeenCalledWith('org-9')
    expect(deps.countActiveLessonRuns).toHaveBeenCalledWith('org-9')
    expect(deps.getLimits).toHaveBeenCalledWith('org-9')
    expect(deps.getAiDailyUsed).toHaveBeenCalledWith('org-9')
    expect(deps.getAiMonthlyUsed).toHaveBeenCalledWith('org-9')
  })

  it('propagates errors from getLimits (e.g. missing plan)', async () => {
    const deps = makeDeps({ getLimits: vi.fn().mockRejectedValue(new Error('この組織にはプランが設定されていません')) })
    await expect(buildOrgUsageDashboard(deps, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
