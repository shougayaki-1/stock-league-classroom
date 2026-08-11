import { describe, expect, it, vi } from 'vitest'
import { releaseTeacherSeatReservation, suspendOrgMember } from './suspendMember'

const makeCleanupFirestore = (input: {
  member: Record<string, unknown>
  school?: Record<string, unknown>
  reservation?: Record<string, unknown>
}) => {
  const documents = new Map<string, Record<string, unknown>>([
    ['organizations/school-1/members/uid-2', input.member],
  ])
  if (input.school) documents.set('organizations/school-1', input.school)
  if (input.reservation) {
    documents.set('organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2', input.reservation)
  }
  const deleted: string[] = []
  let failNextDelete = false
  return {
    documents,
    deleted,
    failNextDelete: () => { failNextDelete = true },
    runTransaction: async (operation: (transaction: {
      get: (path: string) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      delete: (path: string) => void
    }) => Promise<void>) => {
      let hasWritten = false
      return operation({
        get: async (path) => {
          if (hasWritten) throw new Error('Firestore transactions require all reads before writes')
          return { exists: documents.has(path), data: () => documents.get(path) }
        },
        delete: (path) => {
          hasWritten = true
          if (failNextDelete) {
            failNextDelete = false
            throw new Error('reservation delete failed')
          }
          deleted.push(path)
          documents.delete(path)
        },
      })
    },
  }
}

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
    expect(releaseTeacherSeat).toHaveBeenCalledWith('org-1', 'uid-2', 5)
    expect(syncMembership.mock.invocationCallOrder[0]).toBeLessThan(releaseTeacherSeat.mock.invocationCallOrder[0])
  })

  it('retries cleanup for an already-suspended teacher before returning the existing error', async () => {
    const releaseTeacherSeat = vi.fn()
      .mockRejectedValueOnce(new Error('reservation delete failed'))
      .mockResolvedValueOnce(undefined)
    const deps = {
      getMember: async () => ({ role: 'teacher' as const, status: 'suspended' as const, membershipVersion: 5 }),
      countActiveOwners: async () => 1,
      syncMembership: vi.fn(),
      releaseTeacherSeat,
      nowSeconds: () => 2000,
    }

    await expect(suspendOrgMember(deps, { orgId: 'school-1', uid: 'uid-2' }))
      .rejects.toThrow('reservation delete failed')
    await expect(suspendOrgMember(deps, { orgId: 'school-1', uid: 'uid-2' }))
      .rejects.toThrow('このメンバーは既に解除されています')

    expect(releaseTeacherSeat).toHaveBeenNthCalledWith(1, 'school-1', 'uid-2', 5)
    expect(releaseTeacherSeat).toHaveBeenNthCalledWith(2, 'school-1', 'uid-2', 5)
    expect(deps.syncMembership).not.toHaveBeenCalled()
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
    const fake = makeCleanupFirestore({
      member: { role: 'teacher', status: 'suspended', membershipVersion: 5 },
      school: { type: 'school', parentOrgId: 'parent-1' },
      reservation: { resourceKey: 'teacherSeats', schoolOrgId: 'school-1', targetId: 'uid-2' },
    })

    await releaseTeacherSeatReservation({
      firestore: fake,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5 })

    expect(fake.deleted).toEqual([
      'organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2',
    ])
  })

  it('does nothing for an organization without a parent organization', async () => {
    const fake = makeCleanupFirestore({
      member: { role: 'teacher', status: 'suspended', membershipVersion: 5 },
      school: { type: 'school' },
    })

    await releaseTeacherSeatReservation({
      firestore: fake,
    }, { schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5 })

    expect(fake.deleted).toEqual([])
  })

  it('does not delete a new reservation when the member is active or the expected version is stale', async () => {
    const activeFake = makeCleanupFirestore({
      member: { role: 'teacher', status: 'active', membershipVersion: 6 },
      school: { type: 'school', parentOrgId: 'parent-1' },
      reservation: { resourceKey: 'teacherSeats', schoolOrgId: 'school-1', targetId: 'uid-2' },
    })
    await releaseTeacherSeatReservation({ firestore: activeFake }, {
      schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5,
    })

    const staleFake = makeCleanupFirestore({
      member: { role: 'teacher', status: 'suspended', membershipVersion: 6 },
      school: { type: 'school', parentOrgId: 'parent-1' },
      reservation: { resourceKey: 'teacherSeats', schoolOrgId: 'school-1', targetId: 'uid-2' },
    })
    await releaseTeacherSeatReservation({ firestore: staleFake }, {
      schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5,
    })

    expect(activeFake.deleted).toEqual([])
    expect(staleFake.deleted).toEqual([])
  })

  it('retries a failed guarded cleanup without changing the suspended member', async () => {
    const fake = makeCleanupFirestore({
      member: { role: 'teacher', status: 'suspended', membershipVersion: 5 },
      school: { type: 'school', parentOrgId: 'parent-1' },
      reservation: { resourceKey: 'teacherSeats', schoolOrgId: 'school-1', targetId: 'uid-2' },
    })
    fake.failNextDelete()

    await expect(releaseTeacherSeatReservation({ firestore: fake }, {
      schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5,
    })).rejects.toThrow('reservation delete failed')
    expect(fake.documents.has('organizations/parent-1/quotaReservations/teacherSeats:school-1:uid-2')).toBe(true)

    await expect(releaseTeacherSeatReservation({ firestore: fake }, {
      schoolOrgId: 'school-1', teacherUid: 'uid-2', expectedMembershipVersion: 5,
    })).resolves.toBeUndefined()
    expect(fake.deleted).toHaveLength(1)
    expect(fake.documents.get('organizations/school-1/members/uid-2')).toMatchObject({
      status: 'suspended', membershipVersion: 5,
    })
  })
})
