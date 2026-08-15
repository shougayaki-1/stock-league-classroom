import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { setStudentDataRetentionDays } from './studentDataRetentionPolicy'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('setStudentDataRetentionDays', () => {
  it('calls setStudentDataRetentionPolicyCallable with orgId and retentionDays', async () => {
    const callable = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    await setStudentDataRetentionDays({} as never, { orgId: 'org-1', retentionDays: 365 })
    expect(httpsCallable).toHaveBeenCalledWith({}, 'setStudentDataRetentionPolicyCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'org-1', retentionDays: 365 })
  })
})
