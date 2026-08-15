import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateOverviewPage } from './TemplateOverviewPage'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'

vi.mock('../../../lib/ai/generateLessonDraft', () => ({ generateLessonDraft: vi.fn() }))

const answers = {
  goal: 'MARKET_AND_INVESTING' as const,
  mainObjective: '需給',
  lessonDurationMinutes: 50,
  studentCount: 30,
  deviceEnvironment: 'ONE_PER_STUDENT' as const,
  teamMode: 'TEAM' as const,
  readingDepth: 'STANDARD' as const,
  theme: '企業',
  difficulty: 'STANDARD' as const,
  companyCount: 5,
  useEarnings: true,
  useUncertainty: false,
  infoVsDemandWeight: 'BALANCED' as const,
  alwaysOnMarketMinutes: 20,
  predictionCheckpoints: 2,
  evaluationFocus: 'OPERATION_RESULT' as const,
}

describe('TemplateOverviewPage', () => {
  const props = {
    answers,
    onCreate: vi.fn(),
    creating: false,
    functions: {} as never,
    aiBetaState: 'APPROVED' as const,
  }

  it('compares tiers and creates the selected draft', () => {
    const create = vi.fn()
    render(<TemplateOverviewPage {...props} onCreate={create} aiEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /標準案/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容で作成' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ subject: 'SOCIAL_STUDIES' }))
  })

  it('shows an AI card only for AI-enabled organizations', () => {
    const { rerender } = render(<TemplateOverviewPage {...props} aiEnabled={false} />)
    expect(screen.queryByRole('button', { name: /AI提案/ })).not.toBeInTheDocument()
    rerender(<TemplateOverviewPage {...props} aiEnabled />)
    expect(screen.getByRole('button', { name: /AI提案/ })).toBeInTheDocument()
  })

  it('displays locked guidance and disables button when aiBetaState is LOCKED', () => {
    render(<TemplateOverviewPage {...props} aiEnabled={true} aiBetaState="LOCKED" />)
    expect(screen.getByText('AI提案（限定ベータ）')).toBeInTheDocument()
    expect(screen.getByText(/現在この機能は限定公開です。/)).toBeInTheDocument()
    expect(screen.getByText(/利用には運営者による許可が必要です。/)).toBeInTheDocument()
    const cardButton = screen.getByRole('button', { name: /AI提案（限定ベータ）/ })
    expect(cardButton).toBeDisabled()
  })

  it('disables button when aiBetaState is LOADING', () => {
    render(<TemplateOverviewPage {...props} aiEnabled={true} aiBetaState="LOADING" />)
    const cardButton = screen.getByRole('button', { name: /AI提案/ })
    expect(cardButton).toBeDisabled()
  })

  it('displays error alert and disables button when aiBetaState is ERROR', () => {
    render(<TemplateOverviewPage {...props} aiEnabled={true} aiBetaState="ERROR" />)
    expect(
      screen.getByText('AIベータの利用状態を確認できません。再読み込みしてもう一度お試しください。'),
    ).toBeInTheDocument()
    const cardButton = screen.getByRole('button', { name: /AI提案/ })
    expect(cardButton).toBeDisabled()
  })

  it('uses AI output in the existing confirmation screen on APPROVED and falls back on failure', async () => {
    vi.mocked(generateLessonDraft).mockResolvedValueOnce({
      title: 'AI教材',
      description: 'AI説明',
    })
    render(<TemplateOverviewPage {...props} aiEnabled aiBetaState="APPROVED" />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案を選ぶ/ }))
    expect(await screen.findByDisplayValue('AI教材')).toBeInTheDocument()
  })

  it('correctly passes SOCIAL_STUDIES subject in AI generation', async () => {
    vi.mocked(generateLessonDraft).mockResolvedValueOnce({
      title: 'AI教材',
      description: 'AI説明',
    })
    render(<TemplateOverviewPage {...props} aiEnabled aiBetaState="APPROVED" />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案を選ぶ/ }))
    expect(generateLessonDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subject: 'SOCIAL_STUDIES' }),
    )
  })

  it('correctly passes HOME_ECONOMICS subject in AI generation', async () => {
    vi.mocked(generateLessonDraft).mockResolvedValueOnce({
      title: 'AI教材',
      description: 'AI説明',
    })
    const homeAnswers = {
      goal: 'LIFE_PLANNING' as const,
      mainObjective: '生活設計',
      lessonDurationMinutes: 50,
      studentCount: 30,
      deviceEnvironment: 'ONE_PER_STUDENT' as const,
      teamMode: 'INDIVIDUAL' as const,
      readingDepth: 'STANDARD' as const,
      theme: '家計',
      difficulty: 'STANDARD' as const,
      lifeStageFocus: 'INDEPENDENT' as const,
      courseFormat: 'COMMON_CONDITIONS' as const,
      roundYears: 5 as const,
      coveredConcepts: [],
      eventDisclosure: 'ANNOUNCED' as const,
      evaluationFocus: 'STABILITY' as const,
    }
    render(
      <TemplateOverviewPage
        {...props}
        answers={homeAnswers}
        aiEnabled
        aiBetaState="APPROVED"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /AI提案を選ぶ/ }))
    expect(generateLessonDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subject: 'HOME_ECONOMICS' }),
    )
  })

  it('keeps fixed tiers available when AI generation fails', async () => {
    vi.mocked(generateLessonDraft).mockRejectedValueOnce(new Error('unavailable'))
    render(<TemplateOverviewPage {...props} aiEnabled aiBetaState="APPROVED" />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案を選ぶ/ }))
    expect(
      await screen.findByText('AI提案の生成に失敗しました。固定の案をご利用ください。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /標準案/ })).toBeInTheDocument()
  })

  it('shows a quota message when AI generation is rejected with resource-exhausted', async () => {
    vi.mocked(generateLessonDraft).mockRejectedValueOnce({
      code: 'resource-exhausted',
      message: '本日のAI利用上限に達しました',
    })
    render(<TemplateOverviewPage {...props} aiEnabled aiBetaState="APPROVED" />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案を選ぶ/ }))
    expect(await screen.findByText(/上限/)).toBeInTheDocument()
  })
})
