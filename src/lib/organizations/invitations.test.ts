import { describe, expect, it, vi } from 'vitest'
import { httpsCallable } from 'firebase/functions'
import { acceptInvitation, createInvitation, listMyInvitations } from './invitations'

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

describe('invitations client wrappers', () => {
  it('createInvitation calls createInvitationCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: { invitationId: 'invitation-1' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(createInvitation({} as never, { orgId: 'org-1', email: 'x@example.com', role: 'teacher' })).resolves.toEqual({ invitationId: 'invitation-1' })

    expect(httpsCallable).toHaveBeenCalledWith({}, 'createInvitationCallable')
  })

  it('acceptInvitation calls acceptInvitationCallable', async () => {
    const call = vi.fn().mockResolvedValue({ data: { status: 'ACCEPTED' } })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(acceptInvitation({} as never, { orgId: 'org-1', invitationId: 'invitation-1' })).resolves.toEqual({ status: 'ACCEPTED' })

    expect(httpsCallable).toHaveBeenCalledWith({}, 'acceptInvitationCallable')
  })

  it('listMyInvitations calls listMyInvitationsCallable with no arguments', async () => {
    const call = vi.fn().mockResolvedValue({ data: [] })
    vi.mocked(httpsCallable).mockReturnValue(call as never)

    await expect(listMyInvitations({} as never)).resolves.toEqual([])

    expect(httpsCallable).toHaveBeenCalledWith({}, 'listMyInvitationsCallable')
    expect(call).toHaveBeenCalledWith()
  })
})
