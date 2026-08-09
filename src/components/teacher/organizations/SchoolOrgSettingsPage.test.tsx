import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SchoolOrgSettingsPage } from './SchoolOrgSettingsPage'

describe('SchoolOrgSettingsPage', () => {
  it('shows the organization name and existing invitations', () => {
    render(
      <SchoolOrgSettingsPage
        orgName="桜丘高校"
        invitations={[
          {
            id: 'i1',
            orgId: 'org-1',
            email: 'x@example.com',
            role: 'teacher',
            status: 'PENDING',
            invitedByUid: 'u1',
            createdAt: null,
          },
        ]}
        onInvite={vi.fn()}
        inviting={false}
      />,
    )

    expect(screen.getByText('桜丘高校')).toBeInTheDocument()
    expect(screen.getByText('x@example.com')).toBeInTheDocument()
    expect(screen.getByText('招待中')).toBeInTheDocument()
  })

  it('submits the invitation form', () => {
    const onInvite = vi.fn()

    render(<SchoolOrgSettingsPage orgName="桜丘高校" invitations={[]} onInvite={onInvite} inviting={false} />)

    fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待を送る' }))

    expect(onInvite).toHaveBeenCalledWith('new@example.com', 'teacher')
  })
})
