import { describe, expect, it, vi } from 'vitest'
import { changeOrgMemberRole } from './changeRole'

describe('changeOrgMemberRole', () => {
  it('throws when the target member does not exist', async () => {
    await expect(changeOrgMemberRole({
      getMember: async () => null, countActiveOwners: async () => 1, syncMembership: vi.fn(),
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('このメンバーは見つかりません')
  })

  it('throws when the target member is suspended', async () => {
    await expect(changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'suspended', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(),
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('解除されたメンバーのロールは変更できません')
  })

  it('throws when demoting the sole active owner', async () => {
    const syncMembership = vi.fn()
    await expect(changeOrgMemberRole({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })).rejects.toThrow('組織には少なくとも1人のownerが必要です')
    expect(syncMembership).not.toHaveBeenCalled()
  })

  it('allows demoting an owner when another active owner exists', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 2 }),
      countActiveOwners: async () => 2, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-1', newRole: 'admin' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-1', role: 'admin', status: 'active', membershipVersion: 3, revokedAtSeconds: 0 })
  })

  it('changes a non-owner role and advances membershipVersion', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-2', newRole: 'admin' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'admin', status: 'active', membershipVersion: 5, revokedAtSeconds: 0 })
  })

  it('is a no-op guard-wise when newRole equals the current role but still re-syncs', async () => {
    const syncMembership = vi.fn()
    await changeOrgMemberRole({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership,
    }, { orgId: 'org-1', uid: 'uid-2', newRole: 'teacher' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'active', membershipVersion: 2, revokedAtSeconds: 0 })
  })
})
