import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from './TemplateEditorPage'
import { buildDraftFromAnswers } from '../../../lib/lessonTemplates/guidedBuilderPresets'
import { listMaterials } from '../../../lib/ai/materialsRepository'
import { generateLessonDraft } from '../../../lib/ai/generateLessonDraft'
vi.mock('../../../lib/ai/materialsRepository', () => ({ listMaterials: vi.fn(), uploadMaterial: vi.fn() }))
vi.mock('../../../lib/ai/generateLessonDraft', () => ({ generateLessonDraft: vi.fn() }))
const draft = buildDraftFromAnswers({ goal: 'LIFE_PLANNING', mainObjective: '', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'INDIVIDUAL', readingDepth: 'STANDARD', theme: '教材', difficulty: 'STANDARD', lifeStageFocus: 'INDEPENDENT', courseFormat: 'COMMON_CONDITIONS', roundYears: 5, coveredConcepts: [], eventDisclosure: 'ANNOUNCED', evaluationFocus: 'STABILITY' }, 'STANDARD')
describe('TemplateEditorPage', () => {
  const props = { draft, templateId: 't1', orgId: 'org-1', storage: {} as never, firestore: {} as never, functions: {} as never, onPublish: vi.fn(), saving: false, publishing: false, materialsUploadEnabled: false, derivatives: [] }
  it('edits and saves an added household', () => { const save = vi.fn(); render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={save} />); fireEvent.click(screen.getByRole('tab', { name: '主要な一覧' })); fireEvent.click(screen.getByRole('button', { name: '担当プロフィールを追加' })); fireEvent.click(screen.getByRole('button', { name: '下書き保存' })); expect(save.mock.calls[0][0].homeEconomics.households.length).toBe(2) })
  it('updates editable title and description from selected materials without saving', async () => {
    const save = vi.fn(); vi.mocked(listMaterials).mockResolvedValue([{ id: 'm1', fileName: '資料.pdf', text: '内容' }]); vi.mocked(generateLessonDraft).mockResolvedValue({ title: 'AIタイトル', description: 'AI説明' })
    render(<TemplateEditorPage {...props} aiEnabled materialsUploadEnabled onSaveDraft={save} />); fireEvent.click(screen.getByRole('tab', { name: '資料' })); await waitFor(() => expect(screen.getByRole('checkbox', { name: '資料.pdf' })).toBeInTheDocument()); fireEvent.click(screen.getByRole('checkbox', { name: '資料.pdf' })); fireEvent.click(screen.getByRole('button', { name: '資料を使ってAI提案を更新' })); await waitFor(() => expect(screen.getByLabelText('タイトル')).toHaveValue('AIタイトル')); fireEvent.click(screen.getByRole('tab', { name: '基本情報' })); expect(screen.getByLabelText('説明')).toHaveValue('AI説明'); expect(save).not.toHaveBeenCalled()
  })
  it('shows a quota message when regeneration is rejected with resource-exhausted', async () => {
    vi.mocked(listMaterials).mockResolvedValue([{ id: 'm1', fileName: '資料.pdf', text: '内容' }])
    vi.mocked(generateLessonDraft).mockRejectedValueOnce({ code: 'resource-exhausted', message: '今月のAI利用上限に達しました' })
    render(<TemplateEditorPage {...props} aiEnabled materialsUploadEnabled onSaveDraft={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: '資料' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '資料.pdf' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '資料.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: '資料を使ってAI提案を更新' }))
    expect(await screen.findByText(/上限/)).toBeInTheDocument()
  })
  it('shows the source template attribution when sourceTemplateTitle is set', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} sourceTemplateTitle="元の授業" />)
    expect(screen.getByText(/元の授業/)).toBeInTheDocument()
  })

  it('hides the derivatives section when there are none', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} />)
    expect(screen.queryByText('この教材から派生した公開教材')).not.toBeInTheDocument()
  })

  it('lists derivative templates when present', () => {
    render(<TemplateEditorPage {...props} aiEnabled={false} onSaveDraft={vi.fn()} derivatives={[
      { id: 'd1', title: '派生教材A', description: '説明A', subject: 'SOCIAL_STUDIES', currentPublishedVersionId: 'v1' },
    ]} />)
    expect(screen.getByText('この教材から派生した公開教材')).toBeInTheDocument()
    expect(screen.getByText('派生教材A')).toBeInTheDocument()
  })
})
