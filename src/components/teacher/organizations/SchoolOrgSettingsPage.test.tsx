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
  onExportStudentData: vi.fn(),
  exportingStudentData: false,
  auditLogEntries: [],
  loadingAuditLog: false,
  studentDataRetentionDays: null,
  settingRetentionPolicy: false,
  onSetStudentDataRetentionDays: vi.fn(),
  purgingOrg: false,
  onPurgeOrg: vi.fn(),
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

  it('links to the usage dashboard page', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '利用状況ダッシュボードを見る' })).toHaveAttribute('href', '/teacher/organizations/org-1/usage-dashboard')
  })
})

describe('member list', () => {
  it('shows the seat usage and member list', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-owner" canManageMembers suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
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
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('button', { name: '解除' })).toHaveLength(1)
  })

  it('hides suspend buttons entirely when the viewer cannot manage members', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
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
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
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
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('option', { name: 'owner' })).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false}
          members={members} viewerUid="uid-teacher" canManageMembers={false} suspending={false} onSuspendMember={vi.fn()} teacherSeatLimit={5}
          onRevokeInvitation={vi.fn()} onChangeRole={vi.fn()} onExportStudentData={vi.fn()} exportingStudentData={false} />
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
          onRevokeInvitation={vi.fn()} onChangeRole={onChangeRole} onExportStudentData={vi.fn()} exportingStudentData={false} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('uid-teacherのロール'), { target: { value: 'admin' } })
    expect(onChangeRole).toHaveBeenCalledWith('uid-teacher', 'admin')
  })

  it('shows the approvals link to an owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '承認待ちテンプレートを確認' })).toHaveAttribute('href', '/teacher/organizations/org-1/template-approvals')
  })

  it('hides the approvals link from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: '承認待ちテンプレートを確認' })).not.toBeInTheDocument()
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

  it('shows an export-student-data button to an owner and calls onExportStudentData on click', () => {
    const onExportStudentData = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onExportStudentData={onExportStudentData} exportingStudentData={false} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '生徒データを一括エクスポート' }))
    expect(onExportStudentData).toHaveBeenCalled()
  })

  it('hides the export-student-data button from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} onExportStudentData={vi.fn()} exportingStudentData={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '生徒データを一括エクスポート' })).not.toBeInTheDocument()
  })

  it('shows audit log entries to an owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members}
          auditLogEntries={[{ id: 'log-1', actorUid: 'uid-owner', action: 'EXPORT_ORG_STUDENT_DATA', result: 'SUCCESS', occurredAt: '2026-08-15T00:00:00.000Z' }]} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/EXPORT_ORG_STUDENT_DATA/)).toBeInTheDocument()
  })

  it('hides the audit log section from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('監査ログ')).not.toBeInTheDocument()
  })

  it('shows the retention policy form to an owner and submits the entered days', () => {
    const onSetStudentDataRetentionDays = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onSetStudentDataRetentionDays={onSetStudentDataRetentionDays} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/保持日数/), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSetStudentDataRetentionDays).toHaveBeenCalledWith(400)
  })

  it('hides the retention policy form from a non-owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('生徒データの保持期間')).not.toBeInTheDocument()
  })

  it('only enables the delete button once the owner types the exact orgId', () => {
    const onPurgeOrg = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-owner" members={members} onPurgeOrg={onPurgeOrg} />
      </MemoryRouter>,
    )
    const deleteButton = screen.getByRole('button', { name: '完全に削除する' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/組織ID.*を入力/), { target: { value: 'wrong-id' } })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/組織ID.*を入力/), { target: { value: 'org-1' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)
    expect(onPurgeOrg).toHaveBeenCalled()
  })

  it('hides the delete-org section from a non-owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage orgName="桜丘高校" orgId="org-1" invitations={[]} onInvite={vi.fn()} inviting={false} {...memberProps} viewerUid="uid-teacher" members={members} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('組織の完全削除')).not.toBeInTheDocument()
  })
})

describe('student data search', () => {
  const adminMembers = [
    { uid: 'uid-admin', email: 'admin@example.com', role: 'admin' as const, status: 'active' as const, membershipVersion: 1 },
    { uid: 'uid-teacher', email: 'teacher@example.com', role: 'teacher' as const, status: 'active' as const, membershipVersion: 1 },
  ]

  it('shows the student data search section to an owner', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('生徒データ検索')).toBeInTheDocument()
  })

  it('shows the student data search section to an admin', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-admin"
          members={adminMembers}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('生徒データ検索')).toBeInTheDocument()
  })

  it('hides the student data search section from a teacher', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-teacher"
          members={members}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('生徒データ検索')).not.toBeInTheDocument()
  })

  it('disables search button when query or reason is empty, and enables when both are filled', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
        />
      </MemoryRouter>,
    )
    const searchButton = screen.getByRole('button', { name: '検索' })
    expect(searchButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/検索値/), { target: { value: '山田 太郎' } })
    expect(searchButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/閲覧理由/), { target: { value: '学籍照会' } })
    expect(searchButton).toBeEnabled()
  })

  it('provides search field selection for displayName and externalIdentifier and indicates exact match', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/完全一致/)).toBeInTheDocument()
    expect(screen.getByLabelText(/検索項目/)).toBeInTheDocument()
  })

  it('calls onSearchStudentData with field, query, and reason on submit', () => {
    const onSearchStudentData = vi.fn()
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
          onSearchStudentData={onSearchStudentData}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/検索項目/), { target: { value: 'externalIdentifier' } })
    fireEvent.change(screen.getByLabelText(/検索値/), { target: { value: 'STU-001' } })
    fireEvent.change(screen.getByLabelText(/閲覧理由/), { target: { value: '学籍照会のため' } })
    fireEvent.click(screen.getByRole('button', { name: '検索' }))

    expect(onSearchStudentData).toHaveBeenCalledWith({
      field: 'externalIdentifier',
      query: 'STU-001',
      reason: '学籍照会のため',
    })
  })

  it('disables search button while searchingStudentData is true', () => {
    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
          searchingStudentData
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(/検索値/), { target: { value: '山田 太郎' } })
    fireEvent.change(screen.getByLabelText(/閲覧理由/), { target: { value: '学籍照会' } })
    expect(screen.getByRole('button', { name: '検索中…' })).toBeDisabled()
  })

  it('displays search results, 10-minute notice, and calls onClearStudentDataSearch on close', () => {
    const onClearStudentDataSearch = vi.fn()
    const result = {
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: false,
      matches: [
        {
          lessonRunId: 'run-alpha',
          participantId: 'p-1',
          displayName: '山田 太郎',
          externalIdentifier: 'ID-001',
          status: 'ACTIVE',
        },
      ],
    }

    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
          studentDataSearchResult={result}
          onClearStudentDataSearch={onClearStudentDataSearch}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/この個票は10分後に自動的に閉じられます/)).toBeInTheDocument()
    expect(screen.getByText('山田 太郎')).toBeInTheDocument()
    expect(screen.getByText(/ID-001/)).toBeInTheDocument()
    expect(screen.getByText(/run-alpha/)).toBeInTheDocument()
    expect(screen.getByText(/ACTIVE/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClearStudentDataSearch).toHaveBeenCalledTimes(1)
  })

  it('displays truncation notice when truncated is true', () => {
    const result = {
      expiresAt: '2026-08-15T12:10:00.000Z',
      truncated: true,
      matches: [
        {
          lessonRunId: 'run-1',
          participantId: 'p-1',
          displayName: '同姓同名',
        },
      ],
    }

    render(
      <MemoryRouter>
        <SchoolOrgSettingsPage
          orgName="桜丘高校"
          orgId="org-1"
          invitations={[]}
          onInvite={vi.fn()}
          inviting={false}
          {...memberProps}
          viewerUid="uid-owner"
          members={members}
          studentDataSearchResult={result}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/先頭50件/)).toBeInTheDocument()
  })
})




