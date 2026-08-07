import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveSlide } from './LiveSlide'

describe('LiveSlide', () => {
  it('shows the phase name, remaining time, public info, anonymous per-team aggregates, and teacher guidance', () => {
    render(
      <LiveSlide
        title="株価変動を体験しよう"
        phaseName="フェーズ2: 決算発表"
        remainingSeconds={95}
        publicInfo={['A社が増収増益を発表', '市場全体は横ばい']}
        teams={[
          { teamId: 't1', displayName: 'チームA', publicAggregateLabel: '1位' },
          { teamId: 't2', displayName: 'チームB', publicAggregateLabel: '2位' },
        ]}
        teacherGuidance="スマホを置いて前を見てください"
      />,
    )

    expect(screen.getByText('フェーズ2: 決算発表')).toBeInTheDocument()
    expect(screen.getByText(/95/)).toBeInTheDocument()
    expect(screen.getByText('A社が増収増益を発表')).toBeInTheDocument()
    expect(screen.getByText('市場全体は横ばい')).toBeInTheDocument()
    expect(screen.getByText('チームA')).toBeInTheDocument()
    expect(screen.getByText('1位')).toBeInTheDocument()
    expect(screen.getByText('チームB')).toBeInTheDocument()
    expect(screen.getByText('2位')).toBeInTheDocument()
    expect(screen.getByText('スマホを置いて前を見てください')).toBeInTheDocument()
  })

  it('renders gracefully when phaseName/remainingSeconds/publicInfo are absent (not part of the current display projection)', () => {
    render(<LiveSlide title="タイトル" teams={[]} teacherGuidance={null} />)
    expect(screen.getByText('タイトル')).toBeInTheDocument()
    expect(screen.queryByText(/残り/)).not.toBeInTheDocument()
  })
})
