import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { createSchoolOrg } from './schoolOrg'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('createSchoolOrg', () => {
  it('calls createSchoolOrgCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: { orgId: 'school_1' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(createSchoolOrg({} as never, { name: '桜丘高校' })).resolves.toEqual({ orgId: 'school_1' })

    expect(httpsCallable).toHaveBeenCalledWith({}, 'createSchoolOrgCallable')
    expect(call).toHaveBeenCalledWith({ name: '桜丘高校' })
  })
})
