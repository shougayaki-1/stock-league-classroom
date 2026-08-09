import { describe, expect, it } from 'vitest'
import { getOrgPlanLimits } from './planLimits'

const limits = {
  concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0,
  templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
}

describe('getOrgPlanLimits', () => {
  it('resolves the org plan and returns its limits', async () => {
    const result = await getOrgPlanLimits({
      getOrgPlanId: async (orgId) => { expect(orgId).toBe('org-1'); return 'FREE' },
      getPlanDefinition: async (planId) => { expect(planId).toBe('FREE'); return { planId: 'FREE', displayName: '無料', limits, stripePriceId: null } },
    }, { orgId: 'org-1' })
    expect(result).toEqual(limits)
  })

  it('throws when the organization has no planId', async () => {
    await expect(getOrgPlanLimits({
      getOrgPlanId: async () => null,
      getPlanDefinition: async () => { throw new Error('should not be called') },
    }, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })

  it('throws when the planDefinitions document does not exist', async () => {
    await expect(getOrgPlanLimits({
      getOrgPlanId: async () => 'FREE',
      getPlanDefinition: async () => null,
    }, { orgId: 'org-1' })).rejects.toThrow('この組織にはプランが設定されていません')
  })
})
