import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock pattern as LessonControlRoom.test.tsx: mock only
// the underlying firebase/functions SDK call, and let LessonJoinPage import
// and call the REAL joinLessonRun client wrapper (Task 3).
const callableMock = vi.fn()
const httpsCallableMock = vi.fn(() => callableMock)
vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }))

const { LessonJoinPage } = await import('./LessonJoinPage')

const functions = {} as Functions

beforeEach(() => {
  callableMock.mockReset()
  httpsCallableMock.mockClear()
})

describe('LessonJoinPage', () => {
  it('pre-fills the join code from a QR deep link', () => {
    render(<LessonJoinPage functions={functions} initialJoinCode="ABC123" onJoined={vi.fn()} />)
    expect(screen.getByLabelText(/参加コード/)).toHaveValue('ABC123')
  })

  it('lets the student choose among the 3 identity modes', () => {
    render(<LessonJoinPage functions={functions} onJoined={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /学校アカウント/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /簡単参加/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /チーム(の)?端末/ })).toBeInTheDocument()
  })

  it('calls joinLessonRun with the entered fields and calls onJoined on success, without ever showing the duplicate-identifier warning to the student', async () => {
    callableMock.mockResolvedValue({
      data: { lessonRunId: 'run-1', participantId: 'p-1', teamId: 'team-a', duplicateIdentifierWarning: true, deduplicated: false },
    })
    const onJoined = vi.fn()
    const user = userEvent.setup()
    render(<LessonJoinPage functions={functions} onJoined={onJoined} />)

    await user.type(screen.getByLabelText(/参加コード/), 'JOIN01')
    await user.click(screen.getByRole('radio', { name: /簡単参加/ }))
    await user.type(screen.getByLabelText(/表示名/), 'たなか')
    await user.click(screen.getByRole('button', { name: /参加する/ }))

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(
      expect.objectContaining({ lessonRunId: 'run-1', participantId: 'p-1', duplicateIdentifierWarning: true }),
    ))

    // The student must never see any text revealing the duplicate-identifier
    // warning — that is teacher-only (Task 11 ParticipantMonitor).
    expect(screen.queryByText(/重複/)).not.toBeInTheDocument()
    expect(screen.queryByText(/出席番号の重複/)).not.toBeInTheDocument()

    expect(callableMock).toHaveBeenCalledWith(expect.objectContaining({
      joinCode: 'JOIN01', identityMode: 'QUICK_JOIN', displayName: 'たなか',
    }))
  })

  it('shows a Japanese error message when the join code is not found, and does not call onJoined', async () => {
    callableMock.mockRejectedValue({ code: 'functions/not-found' })
    const onJoined = vi.fn()
    const user = userEvent.setup()
    render(<LessonJoinPage functions={functions} onJoined={onJoined} />)

    await user.type(screen.getByLabelText(/参加コード/), 'NOPE')
    await user.click(screen.getByRole('radio', { name: /簡単参加/ }))
    await user.type(screen.getByLabelText(/表示名/), 'たなか')
    await user.click(screen.getByRole('button', { name: /参加する/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/参加コード/)
    expect(onJoined).not.toHaveBeenCalled()
  })

  it('does not submit while required fields (join code / display name) are empty', async () => {
    const user = userEvent.setup()
    render(<LessonJoinPage functions={functions} onJoined={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: /簡単参加/ }))
    expect(screen.getByRole('button', { name: /参加する/ })).toBeDisabled()
    expect(callableMock).not.toHaveBeenCalled()
  })

  it('keeps every operable control at least 44px tall (§23.5)', () => {
    render(<LessonJoinPage functions={functions} onJoined={vi.fn()} />)
    const submit = screen.getByRole('button', { name: /参加する/ })
    expect(Number.parseFloat(getComputedStyle(submit).minHeight)).toBeGreaterThanOrEqual(44)
  })
})
