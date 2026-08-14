import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateOverviewPage } from './TemplateOverviewPage'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'
vi.mock('../../../lib/ai/generateLessonDraft', () => ({ generateLessonDraft: vi.fn() }))
const answers = { goal: 'MARKET_AND_INVESTING' as const, mainObjective: '需給', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT' as const, teamMode: 'TEAM' as const, readingDepth: 'STANDARD' as const, theme: '企業', difficulty: 'STANDARD' as const, companyCount: 5, useEarnings: true, useUncertainty: false, infoVsDemandWeight: 'BALANCED' as const, alwaysOnMarketMinutes: 20, predictionCheckpoints: 2, evaluationFocus: 'OPERATION_RESULT' as const }
describe('TemplateOverviewPage', () => {
  const props = { answers, onCreate: vi.fn(), creating: false, functions: {} as never }
  it('compares tiers and creates the selected draft', () => { const create = vi.fn(); render(<TemplateOverviewPage {...props} onCreate={create} aiEnabled={false} />); fireEvent.click(screen.getByRole('button', { name: /標準案/ })); fireEvent.click(screen.getByRole('button', { name: 'この内容で作成' })); expect(create).toHaveBeenCalledWith(expect.objectContaining({ subject: 'SOCIAL_STUDIES' })) })
  it('shows an AI card only for AI-enabled organizations', () => { const { rerender } = render(<TemplateOverviewPage {...props} aiEnabled={false} />); expect(screen.queryByRole('button', { name: /AI提案/ })).not.toBeInTheDocument(); rerender(<TemplateOverviewPage {...props} aiEnabled />); expect(screen.getByRole('button', { name: /AI提案/ })).toBeInTheDocument() })
  it('uses AI output in the existing confirmation screen and falls back on failure', async () => { vi.mocked(generateLessonDraft).mockResolvedValueOnce({ title: 'AI教材', description: 'AI説明' }); render(<TemplateOverviewPage {...props} aiEnabled />); fireEvent.click(screen.getByRole('button', { name: /AI提案/ })); expect(await screen.findByDisplayValue('AI教材')).toBeInTheDocument() })
  it('keeps fixed tiers available when AI generation fails', async () => { vi.mocked(generateLessonDraft).mockRejectedValueOnce(new Error('unavailable')); render(<TemplateOverviewPage {...props} aiEnabled />); fireEvent.click(screen.getByRole('button', { name: /AI提案/ })); expect(await screen.findByText('AI提案の生成に失敗しました。固定の案をご利用ください。')).toBeInTheDocument(); expect(screen.getByRole('button', { name: /標準案/ })).toBeInTheDocument() })
  it('shows a quota message when AI generation is rejected with resource-exhausted', async () => {
    vi.mocked(generateLessonDraft).mockRejectedValueOnce({ code: 'resource-exhausted', message: '本日のAI利用上限に達しました' })
    render(<TemplateOverviewPage {...props} aiEnabled />)
    fireEvent.click(screen.getByRole('button', { name: /AI提案/ }))
    expect(await screen.findByText(/上限/)).toBeInTheDocument()
  })
})
