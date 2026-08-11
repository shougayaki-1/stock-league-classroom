import { describe, expect, it, vi } from 'vitest'
import { releaseTeacherSeatReservation, suspendOrgMember } from './suspendMember'

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
    const releaseTeacherSeat = vi.fn()
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'owner', status: 'active', membershipVersion: 1 }),
      countActiveOwners: async () => 1, syncMembership: vi.fn(), releaseTeacherSeat, nowSeconds: () => 0,
    }, { orgId: 'org-1', uid: 'uid-1' })).rejects.toThrow('組織には少なくとも1人のownerが必要です')
    expect(releaseTeacherSeat).not.toHaveBeenCalled()
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
    const releaseTeacherSeat = vi.fn()
    await suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1, syncMembership, releaseTeacherSeat, nowSeconds: () => 2000,
    }, { orgId: 'org-1', uid: 'uid-2' })
    expect(syncMembership).toHaveBeenCalledWith({ orgId: 'org-1', uid: 'uid-2', role: 'teacher', status: 'suspended', membershipVersion: 5, revokedAtSeconds: 2000 })
    expect(releaseTeacherSeat).toHaveBeenCalledWith('org-1', 'uid-2')
    expect(syncMembership.mock.invocationCallOrder[0]).toBeLessThan(releaseTeacherSeat.mock.invocationCallOrder[0])
  })

  it('does not release the teacher reservation when membership sync fails', async () => {
    const releaseTeacherSeat = vi.fn()
    await expect(suspendOrgMember({
      getMember: async () => ({ role: 'teacher', status: 'active', membershipVersion: 4 }),
      countActiveOwners: async () => 1,
      syncMembership: async () => { throw new Error('sync failed') },
      releaseTeacherSeat,
      nowSeconds: () => 2000,
    }, { orgId: 'school-1', uid: 'uid-2' })).rejects.toThrow('sync failed')

    expect(releaseTeacherSeat).not.toHaveBeenCalled()
  })
})

describe('releaseTeacherSeatReservation', () => {
  it('deletes the deterministic reservation for a school linked to a parent organization', async () => {
    const deleteReservation = vi.fn()

    await releaseTeacherSeatReservation({
      getParentOrgId: async () => 'parent-1',
      deleteReservation,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2' })

    expect(deleteReservation).toHaveBeenCalledWith(
      'organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2',
    )
  })

  it('does nothing for an organization without a parent organization', async () => {
    const deleteReservation = vi.fn()

    await releaseTeacherSeatReservation({
      getParentOrgId: async () => null,
      deleteReservation,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2' })

    expect(deleteReservation).not.toHaveBeenCalled()
  })
})
