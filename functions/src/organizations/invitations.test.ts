import { describe, expect, it, vi } from 'vitest'
import { acceptInvitation, createInvitation, listMyInvitations } from './invitations'

describe('createInvitation', () => {
  it('normalizes the email and creates a PENDING invitation', async () => {
    const created: Record<string, unknown>[] = []
    const result = await createInvitation({
      findPendingInvitation: async () => null,
      createInvitationDoc: async (orgId, data) => {
        created.push({ orgId, ...data })
        return 'invitation-1'
      },
    }, { orgId: 'org-1', email: 'Teacher@Example.com', role: 'teacher', invitedByUid: 'owner-1' })

    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(created).toEqual([{
      orgId: 'org-1',
      email: 'teacher@example.com',
      role: 'teacher',
      status: 'PENDING',
      invitedByUid: 'owner-1',
      createdAt: expect.anything(),
    }])
  })

  it('returns the existing PENDING invitation instead of creating a duplicate', async () => {
    const createInvitationDoc = vi.fn()
    const existing = {
      id: 'invitation-1',
      orgId: 'org-1',
      email: 'teacher@example.com',
      role: 'teacher' as const,
      status: 'PENDING' as const,
      invitedByUid: 'owner-1',
      createdAt: 'x',
    }
    const result = await createInvitation(
      { findPendingInvitation: async () => existing, createInvitationDoc },
      { orgId: 'org-1', email: 'teacher@example.com', role: 'teacher', invitedByUid: 'owner-1' },
    )
    expect(result).toEqual({ invitationId: 'invitation-1' })
    expect(createInvitationDoc).not.toHaveBeenCalled()
  })
})

describe('acceptInvitation', () => {
  const pending = {
    id: 'invitation-1',
    orgId: 'org-1',
    email: 'teacher@example.com',
    role: 'teacher' as const,
    status: 'PENDING' as const,
    invitedByUid: 'owner-1',
    createdAt: 'x',
  }

  it('rejects when the caller email does not match the invitation', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      syncMembership: vi.fn(),
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'other@example.com' }))
      .rejects.toThrow('あなた宛の招待ではありません')
  })

  it('rejects when the invitation is not PENDING', async () => {
    await expect(acceptInvitation({
      getInvitation: async () => ({ ...pending, status: 'ACCEPTED' }),
      getMembership: async () => null,
      syncMembership: vi.fn(),
      markInvitationAccepted: vi.fn(),
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' }))
      .rejects.toThrow('この招待は既に処理されています')
  })

  it('syncs membership and marks the invitation accepted for a new member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => null,
      syncMembership,
      markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ACCEPTED' })
    expect(syncMembership).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'uid-2',
      role: 'teacher',
      status: 'active',
      membershipVersion: 1,
      revokedAtSeconds: 0,
    })
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })

  it('does not re-sync membership when the caller is already an active member', async () => {
    const syncMembership = vi.fn()
    const markInvitationAccepted = vi.fn()
    const result = await acceptInvitation({
      getInvitation: async () => pending,
      getMembership: async () => ({ status: 'active' }),
      syncMembership,
      markInvitationAccepted,
    }, { orgId: 'org-1', invitationId: 'invitation-1', callerUid: 'uid-2', callerEmail: 'teacher@example.com' })

    expect(result).toEqual({ status: 'ALREADY_MEMBER' })
    expect(syncMembership).not.toHaveBeenCalled()
    expect(markInvitationAccepted).toHaveBeenCalledWith('org-1', 'invitation-1')
  })
})

describe('listMyInvitations', () => {
  it('queries pending invitations by the normalized caller email', async () => {
    const queryPendingInvitationsByEmail = vi.fn(async () => [])
    await listMyInvitations({ queryPendingInvitationsByEmail }, { email: 'Teacher@Example.com' })
    expect(queryPendingInvitationsByEmail).toHaveBeenCalledWith('teacher@example.com')
  })
})
