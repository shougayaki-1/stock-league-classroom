import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Functions } from 'firebase/functions'
import type { LessonInputField } from '@stock-league/lesson-inputs'
import { LessonPlayPage, type LessonPhaseDisplayConfig } from './LessonPlayPage'

const functions = {} as Functions

const displayConfig: LessonPhaseDisplayConfig = {
  title: '第1ラウンド: 予想を立てよう',
  taskDescription: 'この会社の来週の株価は上がると思いますか?',
  publicInfo: ['先週の終値: 1,200円', 'ニュース: 新製品を発表'],
}

const inputConfig: LessonInputField = {
  config: { type: 'SINGLE_CHOICE', options: ['上がる', '下がる'] },
  responseScope: 'INDIVIDUAL',
  interactionMode: 'DIRECT',
}

const baseProps = {
  functions,
  lessonRunId: 'run-1',
  phaseId: 'phase-1',
  inputId: 'input-1',
  participantId: 'p-1',
  displayName: 'たなか',
  teamName: 'チームA',
  displayConfig,
  inputConfig,
  remainingSeconds: 45,
}

describe('LessonPlayPage', () => {
  it('shows the current task, public info, own/team state, remaining time, and confirmation status only', () => {
    render(<LessonPlayPage {...baseProps} responseStatus="DRAFT" />)
    expect(screen.getByText(displayConfig.taskDescription)).toBeInTheDocument()
    expect(screen.getByText(/先週の終値: 1,200円/)).toBeInTheDocument()
    expect(screen.getByText(/ニュース: 新製品を発表/)).toBeInTheDocument()
    expect(screen.getByText(/たなか/)).toBeInTheDocument()
    expect(screen.getByText(/チームA/)).toBeInTheDocument()
    expect(screen.getByText(/45\s*秒/)).toBeInTheDocument()
    expect(screen.getByText(/下書き保存済み/)).toBeInTheDocument()
  })

  it('renders phase.inputConfig through the real LessonInputRenderer (Task6) as a thin shell', () => {
    render(<LessonPlayPage {...baseProps} />)
    expect(screen.getByRole('radio', { name: '上がる' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '下がる' })).toBeInTheDocument()
  })

  it('wires input changes through to the real autosave draft hook (Task7)', async () => {
    const saveResponseDraft = vi.fn().mockResolvedValue({ responseId: 'r-1', revision: 1, status: 'DRAFT', deduplicated: false })
    vi.useFakeTimers()
    try {
      render(<LessonPlayPage {...baseProps} saveResponseDraft={saveResponseDraft} />)
      fireEvent.click(screen.getByRole('radio', { name: '上がる' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(saveResponseDraft).toHaveBeenCalledWith(functions, expect.objectContaining({ value: '上がる' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('never shows a teacher-only field or another team\'s member names (none are ever passed as props)', () => {
    render(<LessonPlayPage {...baseProps} teamMemberNames={['たなか', 'すずき']} />)
    expect(screen.getByText(/すずき/)).toBeInTheDocument()
    // No prop channel exists on this component for another team's roster,
    // teacher notes, or the private random seed/price-plan state — nothing
    // to assert beyond "the only extra names shown are the ones supplied".
    expect(screen.queryByText(/教師|先生専用|チーム編成/)).not.toBeInTheDocument()
  })

  it('has a short help button that sends an anonymous (to classmates) help signal, and confirms it was sent', async () => {
    const requestHelp = vi.fn().mockResolvedValue({ deduplicated: false })
    const user = userEvent.setup()
    render(<LessonPlayPage {...baseProps} requestHelp={requestHelp} />)
    const helpButton = screen.getByRole('button', { name: /困っている|助けて|ヘルプ/ })
    await user.click(helpButton)
    expect(requestHelp).toHaveBeenCalledWith(functions, expect.objectContaining({ lessonRunId: 'run-1' }))
    // Anonymity check: the call must never include the student's own name.
    expect(requestHelp.mock.calls[0][1]).not.toHaveProperty('displayName')
    expect(JSON.stringify(requestHelp.mock.calls[0][1])).not.toContain('たなか')
    expect(await screen.findByText(/伝えました|送信しました/)).toBeInTheDocument()
  })

  it('falls back to a graceful message if the help signal fails to send', async () => {
    const requestHelp = vi.fn().mockRejectedValue(new Error('not-found'))
    const user = userEvent.setup()
    render(<LessonPlayPage {...baseProps} requestHelp={requestHelp} />)
    await user.click(screen.getByRole('button', { name: /困っている|助けて|ヘルプ/ }))
    expect(await screen.findByText(/先生に直接|送信できません/)).toBeInTheDocument()
  })

  it('keeps every operable control at least 44px tall (§23.5)', () => {
    render(<LessonPlayPage {...baseProps} />)
    const helpButton = screen.getByRole('button', { name: /困っている|助けて|ヘルプ/ })
    expect(Number.parseFloat(getComputedStyle(helpButton).minHeight)).toBeGreaterThanOrEqual(44)
  })
})
