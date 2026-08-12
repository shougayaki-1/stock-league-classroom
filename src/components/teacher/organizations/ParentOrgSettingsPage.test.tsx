import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ParentOrgSettingsPage } from './ParentOrgSettingsPage'
import type { ParentOrgQuotaUsageResult } from '../../../lib/organizations/parentOrgQuota'

const schools = [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }]
const quotaUsage: ParentOrgQuotaUsageResult = {
  parentOrgId: 'parent-1',
  parentContractState: 'ACTIVE',
  concurrentLessonsAndMarkets: { limit: 10, guaranteed: 6, sharedAvailable: 3, reserved: 1 },
  teacherSeats: { limit: 8, guaranteed: 5, sharedAvailable: 2, reserved: 1 },
  schools: [{
    schoolOrgId: 'school-1',
    concurrentLessonsAndMarkets: { guaranteed: 4, usage: 5, reserved: 1 },
    teacherSeats: { guaranteed: 3, usage: 2, reserved: 0 },
  }],
}

describe('ParentOrgSettingsPage', () => {
  it('shows the org name and child school list', () => { render(<ParentOrgSettingsPage orgName="桜丘市教育委員会" childSchools={schools} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />); expect(screen.getByText('桜丘市教育委員会')).toBeInTheDocument(); expect(screen.getByText('A高校')).toBeInTheDocument() })
  it('links and unlinks a school', () => { const onLinkSchool = vi.fn(); const onUnlinkSchool = vi.fn(); render(<ParentOrgSettingsPage orgName="x" childSchools={schools} onLinkSchool={onLinkSchool} linking={false} onUnlinkSchool={onUnlinkSchool} unlinking={false} />); fireEvent.change(screen.getByLabelText('学校の組織ID'), { target: { value: 'school-2' } }); fireEvent.click(screen.getByRole('button', { name: '追加' })); fireEvent.click(screen.getByRole('button', { name: '解除' })); expect(onLinkSchool).toHaveBeenCalledWith('school-2'); expect(onUnlinkSchool).toHaveBeenCalledWith('school-1') })

  it('shows parent totals and both quota axes for each school', () => {
    render(<ParentOrgSettingsPage orgName="x" childSchools={schools} quotaUsage={quotaUsage} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />)

    expect(screen.getByText('上位組織の利用枠')).toBeInTheDocument()
    expect(screen.getByText('同時授業・市場数: 上限 10 / 保証 6 / 共有残 3 / 予約 1')).toBeInTheDocument()
    expect(screen.getByText('教師席: 上限 8 / 保証 5 / 共有残 2 / 予約 1')).toBeInTheDocument()
    expect(screen.getByText('同時授業・市場数: 保証 4 / 使用中 5 / 共有予約 1')).toBeInTheDocument()
    expect(screen.getByText('教師席: 保証 3 / 使用中 2 / 共有予約 0')).toBeInTheDocument()
  })

  it('keeps allocation controls hidden for a read-only viewer', () => {
    render(<ParentOrgSettingsPage orgName="x" childSchools={schools} quotaUsage={quotaUsage} canEditAllocations={false} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />)

    expect(screen.queryByRole('button', { name: '配分を保存' })).not.toBeInTheDocument()
    expect(screen.getByText('配分の変更はownerまたはadminのみ可能です。')).toBeInTheDocument()
  })

  it('explains and disables unlink when a school has shared reservations', () => {
    const onUnlinkSchool = vi.fn()
    render(<ParentOrgSettingsPage orgName="x" childSchools={schools} quotaUsage={quotaUsage} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={onUnlinkSchool} unlinking={false} />)

    expect(screen.getByText('共有枠の予約が残っているため学校を解除できません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '解除' })).toBeDisabled()
    expect(onUnlinkSchool).not.toHaveBeenCalled()
  })
})
