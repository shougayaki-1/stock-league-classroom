import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { SchoolOrgSettingsPage } from './SchoolOrgSettingsPage'

describe('SchoolOrgSettingsPage', () => {
  it('shows the organization name and existing invitations', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
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
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('桜丘高校')).toBeInTheDocument()
    expect(screen.getByText('x@example.com')).toBeInTheDocument()
    expect(screen.getByText('招待中')).toBeInTheDocument()
  })

  it('submits the invitation form', () => {
    const onInvite = vi.fn()

    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={onInvite} inviting={false} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待を送る' }))

    expect(onInvite).toHaveBeenCalledWith('new@example.com', 'teacher')
  })

  it('links to the plan limits page', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '利用枠を確認' })).toHaveAttribute('href', '/teacher/organizations/org-1/plan-limits')
  })
})
