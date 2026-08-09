import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PendingInvitationsBanner } from './PendingInvitationsBanner'

const invitation = {
  id: 'i1',
  orgId: 'org-1',
  email: 'x@example.com',
  role: 'teacher' as const,
  status: 'PENDING' as const,
  invitedByUid: 'u1',
  createdAt: null,
}

describe('PendingInvitationsBanner', () => {
  it('renders nothing when there are no pending invitations', () => {
    const { container } = render(
      <PendingInvitationsBanner invitations={[]} onAccept={vi.fn()} accepting={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('accepts an invitation', () => {
    const onAccept = vi.fn()

    render(
      <PendingInvitationsBanner
        invitations={[invitation]}
        onAccept={onAccept}
        accepting={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '参加する' }))

    expect(onAccept).toHaveBeenCalledWith(invitation)
  })
})
