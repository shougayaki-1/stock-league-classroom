import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { LessonAnalyticsPage, type LessonAnalyticsPageProps } from './LessonAnalyticsPage'

const baseProps: LessonAnalyticsPageProps = {
  lessonTitle: '株式売買シミュレーション',
  totalParticipantCount: 4,
  aggregate: {
    responseCount: 3,
    confirmedResponseCount: 3,
    surveyRespondentCount: 2,
    rationaleInformationUsageRate: 0.5,
    judgmentChangeCount: 1,
    judgmentChangeRate: 0.5,
    comprehensionDifficultyCount: 1,
    comprehensionAverage: 3.5,
    strugglingParticipantCount: 1,
  },
  teams: [{ teamId: 'team-a', teamName: 'Aチーム' }],
  individualRows: [
    { participantId: 'p-1', displayName: '山田太郎', teamId: 'team-a', rationaleInformationCount: 2, judgmentChanged: true, comprehensionScore: 5, resultGapScore: 3, struggling: false },
    { participantId: 'p-2', displayName: '鈴木花子', teamId: 'team-a', rationaleInformationCount: 0, judgmentChanged: false, comprehensionScore: 2, resultGapScore: null, struggling: true },
  ],
}

describe('LessonAnalyticsPage', () => {
  it('shows the three headline cards: 根拠, 変更, 理解困難', () => {
    render(<LessonAnalyticsPage {...baseProps} />)
    expect(screen.getByText('根拠')).toBeInTheDocument()
    expect(screen.getByText('変更')).toBeInTheDocument()
    expect(screen.getByText('理解困難')).toBeInTheDocument()
  })

  it('never renders a null aggregate metric as "0%" — shows an explicit "データなし" instead', () => {
    render(
      <LessonAnalyticsPage
        {...baseProps}
        aggregate={{
          ...baseProps.aggregate,
          rationaleInformationUsageRate: null,
          judgmentChangeRate: null,
          comprehensionDifficultyCount: null,
        }}
      />,
    )
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getAllByText('データなし').length).toBeGreaterThan(0)
  })

  it('renders a real 0% distinctly from "データなし" when the rate is genuinely zero', () => {
    render(<LessonAnalyticsPage {...baseProps} aggregate={{ ...baseProps.aggregate, rationaleInformationUsageRate: 0 }} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('discloses the survey response rate with both the numerator/denominator and the unanswered count (透明性)', () => {
    render(<LessonAnalyticsPage {...baseProps} />)
    // surveyRespondentCount=2, totalParticipantCount=4 -> unanswered=2
    expect(screen.getByText(/2\s*\/\s*4人/)).toBeInTheDocument()
    expect(screen.getByText(/未回答.*2人/)).toBeInTheDocument()
  })

  it('starts with individual rows collapsed under class -> team drill-down, revealing them only after expanding the team', async () => {
    const user = userEvent.setup()
    render(<LessonAnalyticsPage {...baseProps} />)
    expect(screen.queryByText('山田太郎')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aチーム/ }))
    expect(screen.getByText('山田太郎')).toBeInTheDocument()
    expect(screen.getByText('鈴木花子')).toBeInTheDocument()
  })

  it('flags a struggling participant with text, not color alone, once the team is expanded', async () => {
    const user = userEvent.setup()
    render(<LessonAnalyticsPage {...baseProps} />)
    await user.click(screen.getByRole('button', { name: /Aチーム/ }))
    const row = screen.getByText('鈴木花子').closest('li')
    expect(within(row as HTMLElement).getByText(/操作でつまずき/)).toBeInTheDocument()
  })

  it('shows a comprehension ranking that also states its denominator (母数) and unanswered count', () => {
    render(<LessonAnalyticsPage {...baseProps} />)
    // 2 individualRows total, both answered comprehension in this fixture -> denominator 2, unanswered 0
    const ranking = screen.getByRole('region', { name: /理解度ランキング/ })
    expect(within(ranking).getByText(/母数\s*2人/)).toBeInTheDocument()
    expect(within(ranking).getByText(/未回答\s*0人/)).toBeInTheDocument()
  })
})
