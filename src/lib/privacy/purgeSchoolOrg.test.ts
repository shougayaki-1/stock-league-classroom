import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { purgeSchoolOrg } from './purgeSchoolOrg'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('purgeSchoolOrg', () => {
  it('calls purgeSchoolOrgCallable with orgId, confirm, confirmOrgId, and a generated idempotencyKey', async () => {
    const callable = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(callable as never)
    await purgeSchoolOrg({} as never, { orgId: 'school-1' }, () => 'fixed-key')
    expect(httpsCallable).toHaveBeenCalledWith({}, 'purgeSchoolOrgCallable')
    expect(callable).toHaveBeenCalledWith({ orgId: 'school-1', confirm: true, confirmOrgId: 'school-1', idempotencyKey: 'fixed-key' })
  })
})
