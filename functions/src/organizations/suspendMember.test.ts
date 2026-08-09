import { describe, expect, it, vi } from 'vitest'
import { suspendOrgMember } from './suspendMember'

describe('suspendOrgMember', () => {
  it('throws when the target member does not exist', async () => {
    await expect(suspendOrgMember({
      getMember: async () => null, countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('このメンバーは既に解除されています')
  })

  it('throws when the target member is already suspended', async () => {
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'suspended', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('このメンバーは既に解除されています')
  })

  it('throws when the target is the sole active owner', async () => {
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(), nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('組織には少なくとも1人のownerが必要です')
  })

  it('allows suspending an owner when another active owner exists', async () => {
    const syncMembership = vi.fn()
    await suspendOrgMember({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 2 }),
      countActiveOwners: async () => 2, syncMembership, nowSeconds: () => 1000,
    }, { orgId: 'org-1', uid: 'uid-1' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-1', role: 'owner', status: 'suspended', membershipVersion: 3, revokedAtSeconds: 1000 })
  })

  it('suspends a non-owner member and advances membershipVersion', async () => {
    const syncMembership = vi.fn()
    await suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1, syncMembership, nowSeconds: () => 2000,
    }, { orgId: 'org-1', uid: 'uid-2' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'suspended', membershipVersion: 5, revokedAtSeconds: 2000 })
  })
})
