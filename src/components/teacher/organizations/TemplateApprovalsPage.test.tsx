import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateApprovalsPage } from './TemplateApprovalsPage'
import type { PendingTemplateApproval } from '../../../lib/lessonTemplates/templateApprovals'

const items: PendingTemplateApproval[] = [{ id: 'tpl-1', title: '株式市場入門', createdByUid: 'teacher-a', updatedAt: null }]

describe('TemplateApprovalsPage', () => {
  it('shows a loading indicator when data is not yet loaded', () => {
    render(<TemplateApprovalsPage data={undefined} error={undefined} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByLabelText('読み込み中')).toBeInTheDocument()
  })

  it('shows an empty message when there is nothing pending', () => {
    render(<TemplateApprovalsPage data={[]} error={undefined} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText('承認待ちのテンプレートはありません。')).toBeInTheDocument()
  })

  it('lists pending templates and calls onApprove/onReject', async () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(<TemplateApprovalsPage data={items} error={undefined} onApprove={onApprove} onReject={onReject} />)
    expect(screen.getByText('株式市場入門')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(onApprove).toHaveBeenCalledWith('tpl-1')
    await userEvent.click(screen.getByRole('button', { name: '却下' }))
    expect(onReject).toHaveBeenCalledWith('tpl-1')
  })
})
