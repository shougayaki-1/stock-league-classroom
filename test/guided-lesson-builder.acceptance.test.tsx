import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuidedBuilderWizard } from '../src/components/teacher/templates/GuidedBuilderWizard'
import { HomeEconomicsQuestionStep } from '../src/components/teacher/templates/wizardSteps/homeEconomics/QuestionSteps'
import { SocialStudiesQuestionStep } from '../src/components/teacher/templates/wizardSteps/socialStudies/QuestionSteps'
import { TemplateOverviewPage } from '../src/components/teacher/templates/TemplateOverviewPage'
import { TemplateEditorPage } from '../src/components/teacher/templates/TemplateEditorPage'
import type { LessonContent } from '../src/lib/lessonTemplates/types'
import type { WizardAnswers } from '../src/lib/lessonTemplates/guidedBuilderTypes'

describe('Guided Lesson Builder acceptance flow', () => {
  it('creates a selected home-economics draft and saves an added household', () => {
    let completed: { goal: string; answers: Record<string, unknown> } | undefined
    const wizard = render(<GuidedBuilderWizard socialStudiesSteps={[SocialStudiesQuestionStep]} homeEconomicsSteps={[HomeEconomicsQuestionStep]} onComplete={(goal, answers) => { completed = { goal, answers }}} />)
    fireEvent.click(screen.getByRole('button', { name: /将来に向けた資産形成/ }))
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    wizard.unmount()
    expect(completed).toBeDefined()

    let created: LessonContent | undefined
    const overview = render(<TemplateOverviewPage answers={{ goal: completed!.goal, ...completed!.answers } as WizardAnswers} creating={false} onCreate={(draft) => { created = draft }} />)
    fireEvent.click(screen.getByRole('button', { name: /標準案/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この内容で作成' }))
    overview.unmount()
    expect(created?.homeEconomics?.courseFormat).toBe('COMMON_CONDITIONS')

    const save = vi.fn()
    render(<TemplateEditorPage draft={created!} saving={false} publishing={false} onSaveDraft={save} onPublish={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: '主要な一覧' }))
    fireEvent.click(screen.getByRole('button', { name: '担当プロフィールを追加' }))
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    expect(save.mock.calls[0][0].homeEconomics.households).toHaveLength(2)
  })
})
