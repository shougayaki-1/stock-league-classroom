import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { listOrgMembers, suspendOrgMember } from './orgMembers'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('orgMembers client wrappers', () => {
  it('listOrgMembers calls listOrgMembersCallable', async () => {
    const call = vi.fn().mockResolvedValue({
      data: [{ uid: 'uid-1', email: 'x@example.com', role: 'owner', status: 'active', membershipVersion: 1 }],
    })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(listOrgMembers({} as never, { orgId: 'org-1' })).resolves.toHaveLength(1)

    expect(httpsCallable).toHaveBeenCalledWith({}, 'listOrgMembersCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1' })
  })

  it('suspendOrgMember calls suspendOrgMemberCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: undefined })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await suspendOrgMember({} as never, { orgId: 'org-1', uid: 'uid-2' })

    expect(httpsCallable).toHaveBeenCalledWith({}, 'suspendOrgMemberCallable')
    expect(call).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2' })
  })
})
