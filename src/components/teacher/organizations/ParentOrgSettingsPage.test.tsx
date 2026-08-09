import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ParentOrgSettingsPage } from './ParentOrgSettingsPage'
const schools = [{ orgId: 'school-1', name: 'A高校', verificationStatus: 'PENDING' }]
describe('ParentOrgSettingsPage', () => {
  it('shows the org name and child school list', () => { render(<ParentOrgSettingsPage orgName="桜丘市教育委員会" childSchools={schools} onLinkSchool={vi.fn()} linking={false} onUnlinkSchool={vi.fn()} unlinking={false} />); expect(screen.getByText('桜丘市教育委員会')).toBeInTheDocument(); expect(screen.getByText('A高校')).toBeInTheDocument() })
  it('links and unlinks a school', () => { const onLinkSchool = vi.fn(); const onUnlinkSchool = vi.fn(); render(<ParentOrgSettingsPage orgName="x" childSchools={schools} onLinkSchool={onLinkSchool} linking={false} onUnlinkSchool={onUnlinkSchool} unlinking={false} />); fireEvent.change(screen.getByLabelText('学校の組織ID'), { target: { value: 'school-2' } }); fireEvent.click(screen.getByRole('button', { name: '追加' })); fireEvent.click(screen.getByRole('button', { name: '解除' })); expect(onLinkSchool).toHaveBeenCalledWith('school-2'); expect(onUnlinkSchool).toHaveBeenCalledWith('school-1') })
})
