import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateEditorPage } from './TemplateEditorPage'
import { buildDraftFromAnswers } from '../../../lib/lessonTemplates/guidedBuilderPresets'
const draft = buildDraftFromAnswers({ goal: 'LIFE_PLANNING', mainObjective: '', lessonDurationMinutes: 50, studentCount: 30, deviceEnvironment: 'ONE_PER_STUDENT', teamMode: 'INDIVIDUAL', readingDepth: 'STANDARD', theme: '教材', difficulty: 'STANDARD', lifeStageFocus: 'INDEPENDENT', courseFormat: 'COMMON_CONDITIONS', roundYears: 5, coveredConcepts: [], eventDisclosure: 'ANNOUNCED', evaluationFocus: 'STABILITY' }, 'STANDARD')
describe('TemplateEditorPage', () => it('edits and saves an added household', () => { const save = vi.fn(); render(<TemplateEditorPage draft={draft} onSaveDraft={save} onPublish={vi.fn()} saving={false} publishing={false} />); fireEvent.click(screen.getByRole('tab', { name: '主要な一覧' })); fireEvent.click(screen.getByRole('button', { name: '担当プロフィールを追加' })); fireEvent.click(screen.getByRole('button', { name: '下書き保存' })); expect(save.mock.calls[0][0].homeEconomics.households.length).toBe(2) }))
