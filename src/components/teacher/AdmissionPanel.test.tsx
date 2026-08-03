import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdmissionPanel } from './AdmissionPanel'

const baseProps = {
  joinCode: 'ABC234',
  capacity: 80,
  teams: [{ id: 'red', name: '赤' }, { id: 'blue', name: '青' }],
  requests: [{ id: 'u1_s', displayName: '山田', requestedTeamId: null }],
  participants: [{ id: 'u2_s', displayName: '鈴木', teamId: 'red', connected: true }],
  mode: 'random' as const,
  onModeChange: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onRemove: vi.fn(),
  onReassign: vi.fn(),
}

describe('AdmissionPanel', () => {
  it('approves and rejects a waiting request', async () => {
    const onApprove = vi.fn(), onReject = vi.fn()
    render(<AdmissionPanel {...baseProps} onApprove={onApprove} onReject={onReject} />)
    await userEvent.click(screen.getByRole('button', { name: '山田 さんを承認' }))
    expect(onApprove).toHaveBeenCalledWith('u1_s', undefined)
    await userEvent.click(screen.getByRole('button', { name: '山田 さんの申請を却下' }))
    expect(onReject).toHaveBeenCalledWith('u1_s')
  })

  it('passes the chosen team when the mode is manual', async () => {
    const onApprove = vi.fn()
    render(<AdmissionPanel {...baseProps} mode="manual" onApprove={onApprove} />)
    await userEvent.selectOptions(screen.getByLabelText('山田 さんの割り当て先'), 'blue')
    await userEvent.click(screen.getByRole('button', { name: '山田 さんを承認' }))
    expect(onApprove).toHaveBeenCalledWith('u1_s', 'blue')
  })

  it('reassigns and removes an approved participant', async () => {
    const onReassign = vi.fn(), onRemove = vi.fn()
    render(<AdmissionPanel {...baseProps} onReassign={onReassign} onRemove={onRemove} />)
    await userEvent.selectOptions(screen.getByLabelText('鈴木 さんのチーム'), 'blue')
    expect(onReassign).toHaveBeenCalledWith('u2_s', 'blue')
    await userEvent.click(screen.getByRole('button', { name: '鈴木 さんを退出させる' }))
    expect(onRemove).toHaveBeenCalledWith('u2_s')
  })

  it('shows the participant count against the capacity', () => {
    const participants = [
      { id: 'u2_s', displayName: '鈴木', teamId: 'red', connected: true },
      { id: 'u3_s', displayName: '佐藤', teamId: 'red', connected: false },
    ]
    render(<AdmissionPanel {...baseProps} participants={participants} />)
    expect(screen.getByText('1 / 80')).toBeInTheDocument()
    const disconnectedItem = screen.getByText('佐藤').closest('li')
    expect(disconnectedItem).toHaveClass('disconnected')
    expect(disconnectedItem).toBeInTheDocument()
  })

  it('resets the manual team choice when a request disappears and returns', async () => {
    const onApprove = vi.fn()
    const request = { id: 'u1_s', displayName: '山田', requestedTeamId: null }
    const { rerender } = render(
      <AdmissionPanel {...baseProps} mode="manual" requests={[request]} onApprove={onApprove} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('山田 さんの割り当て先'), 'blue')
    expect(screen.getByLabelText('山田 さんの割り当て先')).toHaveValue('blue')

    rerender(<AdmissionPanel {...baseProps} mode="manual" requests={[]} onApprove={onApprove} />)

    rerender(<AdmissionPanel {...baseProps} mode="manual" requests={[request]} onApprove={onApprove} />)
    expect(screen.getByLabelText('山田 さんの割り当て先')).toHaveValue('red')
  })

  it('explains the empty state when nobody is waiting', () => {
    render(<AdmissionPanel {...baseProps} requests={[]} />)
    expect(screen.getByText(/参加コードを生徒に共有/)).toBeInTheDocument()
  })

  it('marks a recovery request and names the team it would restore, before approval', () => {
    const requests = [{ id: 'u1_s', displayName: '山田', requestedTeamId: null, recoveryTeamId: 'blue' }]
    render(<AdmissionPanel {...baseProps} requests={requests} />)
    expect(screen.getByText('復帰申請')).toBeInTheDocument()
    expect(screen.getByText(/青の続きに復帰します/)).toBeInTheDocument()
  })

  it('shows the normal waiting copy for a first-time request', () => {
    render(<AdmissionPanel {...baseProps} />)
    expect(screen.queryByText('復帰申請')).not.toBeInTheDocument()
    expect(screen.getByText('参加を待っています')).toBeInTheDocument()
  })
})
