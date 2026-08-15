import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { SchoolOrgSettingsPage } from './SchoolOrgSettingsPage'

const members = [
  { uid: 'uid-owner', email: 'owner@example.com', role: 'owner' as const, status: 'active' as const, membershipVersion: 1 },
  { uid: 'uid-teacher', email: 'teacher@example.com', role: 'teacher' as const, status: 'active' as const, membershipVersion: 1 },
]

const memberProps = {
  members: [],
  viewerUid: 'uid-owner',
  canManageMembers: false,
  onSuspendMember: vi.fn(),
  suspending: false,
  teacherSeatLimit: undefined,
  onRevokeInvitation: vi.fn(),
  onChangeRole: vi.fn(),
}

describe('SchoolOrgSettingsPage', () => {
  it('shows the organization name and existing invitations', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[
            { id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null },
            { id: 'i2', orgId: 'org-1', email: 'y@example.com', role: 'teacher', status: 'REVOKED', invitedByUid: 'u1', createdAt: null },
          ]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          canManageMembers
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('桜丘高校')).toBeInTheDocument()
    expect(screen.getByText('x@example.com')).toBeInTheDocument()
    expect(screen.getByText('招待中')).toBeInTheDocument()
    expect(screen.getByText('y@example.com')).toBeInTheDocument()
    expect(screen.getByText('失効済み')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '失効' })).toHaveLength(1)
  })

  it('calls onRevokeInvitation with the invitation id', () => {
    const onRevokeInvitation = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[{ id: 'i1', orgId: 'org-1', email: 'x@example.com', role: 'teacher', status: 'PENDING', invitedByUid: 'u1', createdAt: null }]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          canManageMembers
          onRevokeInvitation={onRevokeInvitation}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '失効' }))
    expect(onRevokeInvitation).toHaveBeenCalledWith('i1')
  })

  it('submits the invitation form', () => {
    const onInvite = vi.fn()

    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={onInvite} inviting={false} {...memberProps} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('招待するメールアドレス'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '招待を送る' }))

    expect(onInvite).toHaveBeenCalledWith('new@example.com', 'teacher')
  })

  it('links to the plan limits page', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '利用枠を確認' })).toHaveAttribute('href', '/teacher/organizations/org-1/plan-limits')
  })
})

describe('member list', () => {
  it('shows the seat usage and member list', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('教師席: 使用中 2 / 上限 5')).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('teacher@example.com')).toBeInTheDocument()
  })

  it('shows a suspend button for other members but not for the viewer, when the viewer can manage members', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('button', { name: '解除' })).toHaveLength(1)
  })

  it('hides suspend buttons entirely when the viewer cannot manage members', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '解除' })).not.toBeInTheDocument()
  })

  it('calls onSuspendMember with the target uid', () => {
    const onSuspendMember = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={onSuspendMember} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '解除' }))
    expect(onSuspendMember).toHaveBeenCalledWith('uid-teacher')
  })

  it('shows an owner role option only when the viewer is an owner, and hides it otherwise', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('option', { name: 'owner' })).not.toBeInTheDocument()
  })

  it('calls onChangeRole when a new role is selected', () => {
    const onChangeRole = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={onChangeRole} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('uid-teacherのロール'), { target: { value: 'admin' } })
    expect(onChangeRole).toHaveBeenCalledWith('uid-teacher', 'admin')
  })
})

describe('parent organization display', () => {
  it('shows none when unlinked and the name when linked', () => {
    const props = { orgName: '桜丘高校', orgId: 'org-1', invitations: [], onInvite: vi.fn(), inviting: false, ...memberProps }
    const { rerender } = render(<MemoryRouter><SchoolOrgSettingsPage {...props} parentOrgName={null} /></MemoryRouter>)
    expect(screen.getByText('所属する上位組織: なし')).toBeInTheDocument()
    rerender(<MemoryRouter><SchoolOrgSettingsPage {...props} parentOrgName="桜丘市教育委員会" /></MemoryRouter>)
    expect(screen.getByText('所属する上位組織: 桜丘市教育委員会')).toBeInTheDocument()
  })
})
