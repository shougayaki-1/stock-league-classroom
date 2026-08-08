import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExplanationSlide } from './ExplanationSlide'

describe('ExplanationSlide', () => {
  it('shows the teacher guidance and team context, and indicates that the LIVE screen will resume', () => {
    render(
      <ExplanationSlide
        title="株価変動を体験しよう"
        teams={[{ teamId: 't1', displayName: 'チームA', publicAggregateLabel: '1位' }]}
        teacherGuidance="ここで少し補足します"
        previousMode="LIVE"
      />,
    )

    expect(screen.getByText('ここで少し補足します')).toBeInTheDocument()
    expect(screen.getByText('チームA')).toBeInTheDocument()
    // Retains the context of which screen (LIVE) it will return to.
    expect(screen.getByText(/授業中の画面に戻ります/)).toBeInTheDocument()
  })

  it('indicates that the END screen will resume when previousMode is END', () => {
    render(
      <ExplanationSlide
        title="株価変動を体験しよう"
        teams={[]}
        teacherGuidance={null}
        previousMode="END"
      />,
    )
    expect(screen.getByText(/結果画面に戻ります/)).toBeInTheDocument()
  })

  it('renders without a resume hint when no previous mode is known yet (first-ever state is EXPLANATION)', () => {
    render(<ExplanationSlide title="タイトル" teams={[]} teacherGuidance={null} previousMode={null} />)
    expect(screen.queryByText(/画面に戻ります/)).not.toBeInTheDocument()
  })
})
