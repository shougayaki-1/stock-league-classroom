import { describe, expect, it, vi } from 'vitest'
import { syncOrganizationMembershipChange, type MembershipChange } from './membershipSync'

const change: MembershipChange = {
  orgId: 'org-1',
  uid: 'uid-1',
  role: 'teacher',
  status: 'active',
  membershipVersion: 2,
  revokedAtSeconds: 0,
}

describe('syncOrganizationMembershipChange', () => {
  it('marks the mirror pending, then updates Firestore, then commits the mirror as synced, in that order', async () => {
    const calls: string[] = []
    const markMirrorPending = vi.fn(async () => { calls.push('markMirrorPending') })
    const updateFirestoreMembership = vi.fn(async () => { calls.push('updateFirestoreMembership') })
    const commitMirrorSynced = vi.fn(async () => { calls.push('commitMirrorSynced') })

    await syncOrganizationMembershipChange({ markMirrorPending, updateFirestoreMembership, commitMirrorSynced }, change)

    expect(calls).toEqual(['markMirrorPending', 'updateFirestoreMembership', 'commitMirrorSynced'])
    expect(markMirrorPending).toHaveBeenCalledWith(change.orgId, change.membershipVersion)
    expect(updateFirestoreMembership).toHaveBeenCalledWith(change)
    expect(commitMirrorSynced).toHaveBeenCalledWith(change)
  })

  it('leaves the mirror meta pending (never commits SYNCED) when the Firestore update fails', async () => {
    const markMirrorPending = vi.fn(async () => {})
    const updateFirestoreMembership = vi.fn(async () => { throw new Error('firestore write failed') })
    const commitMirrorSynced = vi.fn(async () => {})

    await expect(
      syncOrganizationMembershipChange({ markMirrorPending, updateFirestoreMembership, commitMirrorSynced }, change),
    ).rejects.toThrow('firestore write failed')

    expect(markMirrorPending).toHaveBeenCalledTimes(1)
    expect(commitMirrorSynced).not.toHaveBeenCalled()
  })

  it('leaves the mirror meta pending when the final RTDB commit fails, and a retry converges to SYNCED', async () => {
    let firestoreState: MembershipChange | undefined
    let mirrorSyncState: 'PENDING' | 'SYNCED' | undefined
    let attempt = 0
    const deps = {
      markMirrorPending: vi.fn(async () => { mirrorSyncState = 'PENDING' }),
      updateFirestoreMembership: vi.fn(async (c: MembershipChange) => { firestoreState = c }),
      commitMirrorSynced: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw new Error('rtdb commit failed')
        mirrorSyncState = 'SYNCED'
      }),
    }

    await expect(syncOrganizationMembershipChange(deps, change)).rejects.toThrow('rtdb commit failed')
    expect(mirrorSyncState).toBe('PENDING')
    expect(firestoreState).toEqual(change)

    // Retrying with the same membershipVersion converges to SYNCED without
    // re-deriving a new Firestore write path — grant/suspend/role-change all
    // flow through this single function, never a direct RTDB write.
    await syncOrganizationMembershipChange(deps, change)
    expect(mirrorSyncState).toBe('SYNCED')
    expect(deps.commitMirrorSynced).toHaveBeenCalledTimes(2)
  })
})
