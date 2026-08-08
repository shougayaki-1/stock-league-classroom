import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LessonResultsPage } from './LessonResultsPage'

describe('LessonResultsPage', () => {
  const baseProps = {
    lessonTitle: '株式投資シミュレーション',
    displayName: 'たなか',
    teamName: 'チームA',
    results: [
      {
        responseId: 'resp-1',
        scope: 'participant' as const,
        displayValue: 'BUY 10株',
        decisionExplanation: {
          whatHappened: '回答(responseId: resp-1)が確定されました。',
          whyItHappened: '提案が承認されたためです。',
          alternative: '記録された根拠がありません',
          nextAction: '記録された根拠がありません',
        },
      },
    ],
  }

  it('shows the lesson title, own display name, and own team name', () => {
    render(<LessonResultsPage {...baseProps} />)
    expect(screen.getByText(/株式投資シミュレーション/)).toBeInTheDocument()
    expect(screen.getByText('たなか')).toBeInTheDocument()
    expect(screen.getByText('チームA')).toBeInTheDocument()
  })

  it('renders each result\'s four-part decision explanation', () => {
    render(<LessonResultsPage {...baseProps} />)
    expect(screen.getByText(/回答\(responseId: resp-1\)が確定されました/)).toBeInTheDocument()
    expect(screen.getByText(/提案が承認されたためです/)).toBeInTheDocument()
    expect(screen.getAllByText(/記録された根拠がありません/).length).toBe(2)
  })

  it('shows external task/result links when provided, without any Classroom auto-post control', () => {
    render(<LessonResultsPage {...baseProps} externalTaskUrl="https://classroom.example/task/1" externalResultUrl="https://example.com/results/1" />)
    const taskLink = screen.getByRole('link', { name: /外部課題/ })
    expect(taskLink).toHaveAttribute('href', 'https://classroom.example/task/1')
    const resultLink = screen.getByRole('link', { name: /結果の詳細/ })
    expect(resultLink).toHaveAttribute('href', 'https://example.com/results/1')
    // Auto-posting to Classroom is explicitly out of scope (brief Step 4) —
    // there must be no button/action implying it.
    expect(screen.queryByRole('button', { name: /Classroom|投稿/ })).not.toBeInTheDocument()
  })

  it('shows an empty-state message when there are no results yet', () => {
    render(<LessonResultsPage {...baseProps} results={[]} />)
    expect(screen.getByText(/まだ結果がありません/)).toBeInTheDocument()
  })

  it('never renders a team badge for a participant-scoped result', () => {
    render(<LessonResultsPage {...baseProps} />)
    expect(screen.getByText('自分の回答')).toBeInTheDocument()
    expect(screen.queryByText('チームの回答')).not.toBeInTheDocument()
  })
})
