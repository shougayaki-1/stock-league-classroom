import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OperatorReportsPage } from './OperatorReportsPage'

const reports = [
  { id: 'r1', templateId: 't1', versionId: 'v1', reportedByUid: 'teacher-b', reason: 'COPYRIGHT' as const, details: '出典不明', createdAt: 'sometime', templateTitle: '通報された教材' },
]

describe('OperatorReportsPage', () => {
  it('shows an access-denied message', () => {
    render(<OperatorReportsPage reports={[]} loading={false} accessDenied onUnpublish={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('この画面は運営者のみ利用できます。')).toBeInTheDocument()
  })

  it('lists pending reports and triggers unpublish/dismiss', () => {
    const onUnpublish = vi.fn(); const onDismiss = vi.fn()
    render(<OperatorReportsPage reports={reports} loading={false} accessDenied={false} onUnpublish={onUnpublish} onDismiss={onDismiss} />)
    expect(screen.getByText('通報された教材')).toBeInTheDocument()
    expect(screen.getByText('出典不明')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '非公開化' }))
    expect(onUnpublish).toHaveBeenCalledWith(reports[0])
    fireEvent.click(screen.getByRole('button', { name: '却下' }))
    expect(onDismiss).toHaveBeenCalledWith(reports[0])
  })

  it('shows an empty state with no pending reports', () => {
    render(<OperatorReportsPage reports={[]} loading={false} accessDenied={false} onUnpublish={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('未対応の通報はありません。')).toBeInTheDocument()
  })
})
