import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommunityTemplatesPage } from './CommunityTemplatesPage'

const templates = [
  { id: 't1', title: '公民の授業', description: '説明1', subject: 'SOCIAL_STUDIES' as const, currentPublishedVersionId: 'v1', visibility: 'COMMUNITY' as const },
  { id: 't2', title: '家計管理の授業', description: '説明2', subject: 'HOME_ECONOMICS' as const, currentPublishedVersionId: 'v2', visibility: 'COMMUNITY' as const },
]

describe('CommunityTemplatesPage', () => {
  it('lists templates and duplicates the selected one on click', () => {
    const onDuplicate = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={onDuplicate} onReport={vi.fn()} onOpenDetail={vi.fn()} />)
    expect(screen.getByText('公民の授業')).toBeInTheDocument()
    expect(screen.getByText('家計管理の授業')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '自組織へ複製' })[0])
    expect(onDuplicate).toHaveBeenCalledWith(templates[0])
  })

  it('shows an empty state with no templates', () => {
    render(<CommunityTemplatesPage templates={[]} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={vi.fn()} onReport={vi.fn()} onOpenDetail={vi.fn()} />)
    expect(screen.getByText('公開されている教材がまだありません。')).toBeInTheDocument()
  })

  it('calls onSubjectChange when a subject filter is selected', () => {
    const onSubjectChange = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={onSubjectChange} onDuplicate={vi.fn()} onReport={vi.fn()} onOpenDetail={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '公民' }))
    expect(onSubjectChange).toHaveBeenCalledWith('SOCIAL_STUDIES')
  })

  it('opens a report dialog and submits the selected reason', () => {
    const onReport = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={vi.fn()} onReport={onReport} onOpenDetail={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '通報' })[0])
    fireEvent.click(screen.getByRole('button', { name: '著作権' }))
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(onReport).toHaveBeenCalledWith(templates[0], 'COPYRIGHT', '')
  })
})
