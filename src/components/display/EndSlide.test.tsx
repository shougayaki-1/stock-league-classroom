import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EndSlide } from './EndSlide'

describe('EndSlide', () => {
  it('shows results/ranking (from team aggregates), events, causal explanation, and reflection questions', () => {
    render(
      <EndSlide
        title="株価変動を体験しよう"
        teams={[
          { teamId: 't1', displayName: 'チームA', publicAggregateLabel: '1位 / 資産120万円' },
          { teamId: 't2', displayName: 'チームB', publicAggregateLabel: '2位 / 資産95万円' },
        ]}
        events={['決算発表で株価が急騰', '金利発表で市場全体が下落']}
        causalExplanation="増収増益のニュースにより買い注文が増え、株価が上昇しました"
        reflectionQuestions={['なぜチームAは上位だったと思いますか', 'ニュースが価格に与える影響は何でしたか']}
        teacherGuidance="よく頑張りました"
      />,
    )

    expect(screen.getByText('チームA')).toBeInTheDocument()
    expect(screen.getByText('1位 / 資産120万円')).toBeInTheDocument()
    expect(screen.getByText('チームB')).toBeInTheDocument()
    expect(screen.getByText('2位 / 資産95万円')).toBeInTheDocument()
    expect(screen.getByText('決算発表で株価が急騰')).toBeInTheDocument()
    expect(screen.getByText('金利発表で市場全体が下落')).toBeInTheDocument()
    expect(screen.getByText(/増収増益のニュースにより/)).toBeInTheDocument()
    expect(screen.getByText('なぜチームAは上位だったと思いますか')).toBeInTheDocument()
    expect(screen.getByText('ニュースが価格に与える影響は何でしたか')).toBeInTheDocument()
    expect(screen.getByText('よく頑張りました')).toBeInTheDocument()
  })

  it('renders gracefully when events/causalExplanation/reflectionQuestions are absent', () => {
    render(<EndSlide title="タイトル" teams={[]} teacherGuidance={null} />)
    expect(screen.getByText('タイトル')).toBeInTheDocument()
  })
})
