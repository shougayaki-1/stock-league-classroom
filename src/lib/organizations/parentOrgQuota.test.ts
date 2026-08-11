import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { getParentOrgQuotaUsage, getSchoolEffectiveQuota, setSchoolQuotaAllocation, type ParentOrgQuotaUsageResult, type SchoolEffectiveQuotaResult } from './parentOrgQuota'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

const usage: ParentOrgQuotaUsageResult = {
  parentOrgId: 'parent-1',
  concurrentLessonsAndMarkets: { limit: 10, guaranteed: 6, sharedAvailable: 3, reserved: 1 },
  teacherSeats: { limit: 8, guaranteed: 5, sharedAvailable: 2, reserved: 1 },
  schools: [],
}

const effective: SchoolEffectiveQuotaResult = {
  schoolOrgId: 'school-1',
  parentOrgId: 'parent-1',
  concurrentLessonsAndMarkets: { guaranteed: 2, usage: 3, sharedReserved: 1, effectiveAvailable: 4 },
  teacherSeats: { guaranteed: 2, usage: 1, sharedReserved: 0, effectiveAvailable: 3 },
}

describe('parent organization quota client wrappers', () => {
  it('calls getParentOrgQuotaUsageCallable with the parent org id', async () => {
    const call = vi.fn().mockResolvedValue({ data: usage })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(getParentOrgQuotaUsage({} as never, { parentOrgId: 'parent-1' })).resolves.toEqual(usage)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'getParentOrgQuotaUsageCallable')
    expect(call).toHaveBeenCalledWith({ parentOrgId: 'parent-1' })
  })

  it('calls getSchoolEffectiveQuotaCallable with the school org id', async () => {
    const call = vi.fn().mockResolvedValue({ data: effective })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(getSchoolEffectiveQuota({} as never, { schoolOrgId: 'school-1' })).resolves.toEqual(effective)
    expect(httpsCallable).toHaveBeenCalledWith({}, 'getSchoolEffectiveQuotaCallable')
    expect(call).toHaveBeenCalledWith({ schoolOrgId: 'school-1' })
  })

  it('calls setSchoolQuotaAllocationCallable with both guarantee axes', async () => {
    const call = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(call as never)
    const input = {
      parentOrgId: 'parent-1', schoolOrgId: 'school-1',
      guaranteedConcurrentLessonsAndMarkets: 4, guaranteedTeacherSeats: 3,
    }

    await expect(setSchoolQuotaAllocation({} as never, input)).resolves.toBeUndefined()
    expect(httpsCallable).toHaveBeenCalledWith({}, 'setSchoolQuotaAllocationCallable')
    expect(call).toHaveBeenCalledWith(input)
  })
})
