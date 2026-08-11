import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { getOrgPlanLimits } from './planLimits'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('getOrgPlanLimits', () => {
  it('calls getOrgPlanLimitsCallable with the orgId', async () => {
    const limits = {
      concurrentLessonsAndMarkets: 1, participants: 40, teacherSeats: 1, aiCredits: 0, templateStorage: 5, resultRetentionDays: 30, eventExtraCapacity: 0,
      downgradeStatus: { state: 'NORMAL' as const, violations: [] },
    }
    const call = vi.fn().mockResolvedValue({ data: limits })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    await expect(getOrgPlanLimits({} as never, { orgId: 'org-1' })).resolves.toEqual(limits)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'getOrgPlanLimitsCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1' })
  })
})
