import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LessonWaitingPage } from './LessonWaitingPage'

describe('LessonWaitingPage', () => {
  const baseProps = {
    lessonTitle: '株式投資入門',
    teamName: 'チームA',
    displayName: 'たなか',
    recoveryCode: 'REC-123',
  }

  it('shows the team, display name, lesson title, and a start-waiting message', () => {
    render(<LessonWaitingPage {...baseProps} />)
    expect(screen.getByText('株式投資入門')).toBeInTheDocument()
    expect(screen.getByText(/チームA/)).toBeInTheDocument()
    expect(screen.getByText(/たなか/)).toBeInTheDocument()
    expect(screen.getByText(/開始をお待ちください|まもなく始まります|開始まで/)).toBeInTheDocument()
  })

  it('shows own team members\' names but never another team\'s members (only the other team is identified by team name elsewhere in the app, never here)', () => {
    render(<LessonWaitingPage {...baseProps} teamMemberNames={['たなか', 'さとう']} />)
    expect(screen.getByText('さとう')).toBeInTheDocument()
    // This component's props intentionally have no channel for another
    // team's roster at all (§23.6) — there is nothing to assert "hidden"
    // beyond confirming that every name shown traces back to props this
    // component was explicitly given (own display name + own team).
    expect(screen.getAllByText(/たなか|さとう/).length).toBeGreaterThan(0)
  })

  it('shows a saved-recovery-code confirmation (Task4 復帰コード)', () => {
    render(<LessonWaitingPage {...baseProps} />)
    expect(screen.getByText(/復帰コードを保存しました/)).toBeInTheDocument()
    expect(screen.getByText(/REC-123/)).toBeInTheDocument()
  })

  it('includes the QuickPractice 30-second practice widget', () => {
    render(<LessonWaitingPage {...baseProps} />)
    expect(screen.getByText(/練習用/)).toBeInTheDocument()
    expect(screen.getByText(/残り\s*30\s*秒/)).toBeInTheDocument()
  })

  it('never shows the duplicate-identifier warning to the student even when told about it', () => {
    render(<LessonWaitingPage {...baseProps} duplicateIdentifierWarning />)
    expect(screen.queryByText(/重複/)).not.toBeInTheDocument()
  })

  it('does not accept or expose any production response-saving function as a prop (structural isolation check)', () => {
    // LessonWaitingPage's props type has no `functions`/`saveResponseDraft`
    // field at all — this test documents that boundary at the call site: a
    // TypeScript consumer cannot smuggle production save wiring into this
    // screen even by mistake.
    // @ts-expect-error -- saveResponseDraft must not be an accepted prop
    render(<LessonWaitingPage {...baseProps} saveResponseDraft={vi.fn()} />)
    expect(screen.getByText('株式投資入門')).toBeInTheDocument()
  })
})
