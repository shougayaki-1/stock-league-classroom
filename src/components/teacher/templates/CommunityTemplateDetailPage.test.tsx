import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommunityTemplateDetailPage } from './CommunityTemplateDetailPage'

const template = {
  id: 't1', title: '公民の授業', description: '説明', subject: 'SOCIAL_STUDIES' as const, currentPublishedVersionId: 'v1', visibility: 'COMMUNITY' as const,
  reviewCount: 2, averageClarityRating: 4, averageEaseOfImplementationRating: 3.5, averageStudentResponseRating: 5,
}
const reviews = [{ templateId: 't1', versionId: 'v1', reviewedByUid: 'teacher-x', clarityRating: 4, easeOfImplementationRating: 3, studentResponseRating: 5, comment: 'とても分かりやすかった' }]

describe('CommunityTemplateDetailPage', () => {
  it('shows aggregate ratings and review comments', () => {
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible={false} onSubmitReview={vi.fn()} />)
    expect(screen.getByText('公民の授業')).toBeInTheDocument()
    expect(screen.getByText('とても分かりやすかった')).toBeInTheDocument()
  })

  it('hides the review form when not eligible', () => {
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible={false} onSubmitReview={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'レビューを送信' })).not.toBeInTheDocument()
  })

  it('submits a review when eligible', () => {
    const onSubmitReview = vi.fn()
    render(<CommunityTemplateDetailPage template={template} reviews={reviews} loading={false} eligible onSubmitReview={onSubmitReview} />)
    fireEvent.click(screen.getByRole('button', { name: 'レビューを送信' }))
    expect(onSubmitReview).toHaveBeenCalled()
  })
})
