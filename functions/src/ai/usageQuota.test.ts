import { describe, expect, it, vi } from 'vitest'
import { AiKillSwitchEnabledError, AiQuotaExceededError, checkAiQuota, consumeAiQuota, dailyKey, monthlyKey, type AiUsageQuotaDeps } from './usageQuota'

const baseDeps = (overrides: Partial<AiUsageQuotaDeps> = {}): AiUsageQuotaDeps => ({
  isKillSwitchEnabled: async () => false,
  getLimits: async () => ({ daily: 10, monthly: 100 }),
  getDailyCount: async () => 0,
  getMonthlyCount: async () => 0,
  incrementDailyCount: vi.fn(async () => {}),
  incrementMonthlyCount: vi.fn(async () => {}),
  ...overrides,
})

describe('checkAiQuota', () => {
  it('passes when the kill switch is off and both counts are under their limits', async () => {
    await expect(checkAiQuota(baseDeps(), { orgId: 'org-1' })).resolves.toBeUndefined()
  })

  it('throws AiKillSwitchEnabledError when the kill switch is on, without checking limits', async () => {
    const getLimits = vi.fn()
    await expect(checkAiQuota(baseDeps({ isKillSwitchEnabled: async () => true, getLimits }), { orgId: 'org-1' })).rejects.toBeInstanceOf(AiKillSwitchEnabledError)
    expect(getLimits).not.toHaveBeenCalled()
  })

  it('throws a DAILY AiQuotaExceededError when the daily count has reached the daily limit', async () => {
    const getMonthlyCount = vi.fn()
    const error = await checkAiQuota(baseDeps({ getDailyCount: async () => 10, getMonthlyCount }), { orgId: 'org-1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiQuotaExceededError)
    expect((error as AiQuotaExceededError).period).toBe('DAILY')
    expect(getMonthlyCount).not.toHaveBeenCalled()
  })

  it('throws a MONTHLY AiQuotaExceededError when only the monthly count has reached its limit', async () => {
    const error = await checkAiQuota(baseDeps({ getMonthlyCount: async () => 100 }), { orgId: 'org-1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AiQuotaExceededError)
    expect((error as AiQuotaExceededError).period).toBe('MONTHLY')
  })
})

describe('consumeAiQuota', () => {
  it('increments both the daily and monthly counters', async () => {
    const incrementDailyCount = vi.fn(async () => {})
    const incrementMonthlyCount = vi.fn(async () => {})
    await consumeAiQuota(baseDeps({ incrementDailyCount, incrementMonthlyCount }), { orgId: 'org-1' })
    expect(incrementDailyCount).toHaveBeenCalledWith('org-1')
    expect(incrementMonthlyCount).toHaveBeenCalledWith('org-1')
  })
})

describe('dailyKey', () => {
  it('formats a UTC instant as its JST calendar date', () => {
    // 2026-01-01T15:30:00Z は JST で 2026-01-02T00:30:00
    expect(dailyKey(Date.parse('2026-01-01T15:30:00Z'))).toBe('2026-01-02')
  })
  it('stays on the same JST day for a morning UTC instant', () => {
    // 2026-01-01T02:00:00Z は JST で 2026-01-01T11:00:00
    expect(dailyKey(Date.parse('2026-01-01T02:00:00Z'))).toBe('2026-01-01')
  })
})

describe('monthlyKey', () => {
  it('formats a UTC instant as its JST calendar month', () => {
    expect(monthlyKey(Date.parse('2026-01-31T15:30:00Z'))).toBe('2026-02')
  })
})
