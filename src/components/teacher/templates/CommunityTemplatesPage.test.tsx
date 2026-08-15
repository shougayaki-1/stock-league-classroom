import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommunityTemplatesPage } from './CommunityTemplatesPage'

const templates = [
  { id: 't1', title: '公民の授業', description: '説明1', subject: 'SOCIAL_STUDIES' as const, currentPublishedVersionId: 'v1' },
  { id: 't2', title: '家計管理の授業', description: '説明2', subject: 'HOME_ECONOMICS' as const, currentPublishedVersionId: 'v2' },
]

describe('CommunityTemplatesPage', () => {
  it('lists templates and duplicates the selected one on click', () => {
    const onDuplicate = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={onDuplicate} />)
    expect(screen.getByText('公民の授業')).toBeInTheDocument()
    expect(screen.getByText('家計管理の授業')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '自組織へ複製' })[0])
    expect(onDuplicate).toHaveBeenCalledWith(templates[0])
  })

  it('shows an empty state with no templates', () => {
    render(<CommunityTemplatesPage templates={[]} loading={false} subject={undefined} onSubjectChange={vi.fn()} onDuplicate={vi.fn()} />)
    expect(screen.getByText('公開されている教材がまだありません。')).toBeInTheDocument()
  })

  it('calls onSubjectChange when a subject filter is selected', () => {
    const onSubjectChange = vi.fn()
    render(<CommunityTemplatesPage templates={templates} loading={false} subject={undefined} onSubjectChange={onSubjectChange} onDuplicate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '公民' }))
    expect(onSubjectChange).toHaveBeenCalledWith('SOCIAL_STUDIES')
  })
})
