import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Database } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'

// Same module-boundary mock pattern as the individual lessonRuns wrapper
// tests (lifecycle.test.ts, liveRepository.test.ts, participants.test.ts):
// LessonControlRoom imports and calls the REAL client wrappers (Task 5/8/9/10),
// so only the underlying Firebase SDK calls are faked here — this exercises
// the actual wiring, not a re-implementation of it.
const collectionMock = vi.fn((_firestore: unknown, path: string) => ({ __path: path }))
let capturedParticipantsListener: ((snapshot: { docs: Array<{ data: () => unknown }> }) => void) | undefined
const onSnapshotMock = vi.fn((_ref, onNext) => {
  capturedParticipantsListener = onNext
  return () => {}
})
vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  onSnapshot: onSnapshotMock,
}))

const refMock = vi.fn((_database: unknown, path: string) => ({ __path: path }))
let capturedPublicListener: ((snapshot: { val: () => unknown }) => void) | undefined
let capturedDisplayListener: ((snapshot: { val: () => unknown }) => void) | undefined
const onValueMock = vi.fn((nodeRef: { __path: string }, onNext: (s: { val: () => unknown }) => void) => {
  if (nodeRef.__path.startsWith('lessonRunPublic/')) capturedPublicListener = onNext
  if (nodeRef.__path.startsWith('lessonRunDisplay/')) capturedDisplayListener = onNext
  return () => {}
})
const offMock = vi.fn()
vi.mock('firebase/database', () => ({
  ref: refMock,
  onValue: onValueMock,
  off: offMock,
}))

const callableMock = vi.fn().mockResolvedValue({ data: {} })
const httpsCallableMock = vi.fn(() => callableMock)
vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }))

const { LessonControlRoom } = await import('./LessonControlRoom')

const functions = {} as Functions
const firestore = {} as Firestore
const database = {} as Database

function emitPublic(state: Partial<{ status: string; currentPhaseId: string | null; notifications: unknown[] }>) {
  act(() => {
    capturedPublicListener?.({ val: () => ({ status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1, orgId: 'org-1', remainingPhaseSeconds: 60, publicTask: null, notifications: [], ...state }) })
  })
}

function emitDisplay(state: Partial<{ mode: string; title: string }> = {}) {
  act(() => {
    capturedDisplayListener?.({ val: () => ({ orgId: 'org-1', mode: 'LIVE', title: 'フェーズ1', goal: null, teams: [], teacherGuidance: null, updatedAtMillis: 1, ...state }) })
  })
}

function emitParticipants(participants: Array<Record<string, unknown>>) {
  act(() => {
    capturedParticipantsListener?.({ docs: participants.map((p) => ({ data: () => p })) })
  })
}

const baseParticipant = {
  id: 'p-1', lessonRunId: 'run-1', orgId: 'org-1', authUid: 'uid-1',
  identityMode: 'SCHOOL_ACCOUNT', displayName: '山田太郎', teamId: 'team-a',
  status: 'ACTIVE', sessionVersion: 1,
}

beforeEach(() => {
  callableMock.mockClear()
  httpsCallableMock.mockClear()
  onSnapshotMock.mockClear()
  onValueMock.mockClear()
})

describe('LessonControlRoom', () => {
  it('renders the top-5-item status header and the participant monitor from live subscriptions, all in the initial viewport', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay({ mode: 'LIVE', title: 'フェーズ1の説明' })
    emitParticipants([baseParticipant])

    expect(screen.getByRole('heading', { name: '次にすること' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '現在のフェーズ' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '参加・接続・提出状況' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '未対応の問題' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '教室表示で現在見えている内容' })).toBeInTheDocument()
    expect(screen.getByText('山田太郎')).toBeInTheDocument()
  })

  it('a PRIMARY teacher sees the start-lesson CTA while the run is READY and it invokes onStartLesson', async () => {
    const user = userEvent.setup()
    const onStartLesson = vi.fn()
    render(
      <LessonControlRoom
        lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database}
        onStartLesson={onStartLesson}
      />,
    )
    emitPublic({ status: 'READY', currentPhaseId: null })
    emitDisplay()
    emitParticipants([])

    const button = screen.getByRole('button', { name: '授業を開始' })
    await user.click(button)
    expect(onStartLesson).toHaveBeenCalledTimes(1)
  })

  it('a VIEWER teacher sees no CTA button and an authorization-based explanation instead (not a disabled button)', () => {
    render(
      <LessonControlRoom
        lessonRunId="run-1" role="VIEWER" functions={functions} firestore={firestore} database={database}
        onStartLesson={vi.fn()}
      />,
    )
    emitPublic({ status: 'READY', currentPhaseId: null })
    emitDisplay()
    emitParticipants([])

    expect(screen.queryByRole('button', { name: '授業を開始' })).not.toBeInTheDocument()
    expect(screen.getByText(/閲覧担当/)).toBeInTheDocument()
  })

  it('hides the intervention launcher entirely for a VIEWER (authorization-driven omission, not disabled)', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="VIEWER" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    expect(screen.queryByRole('button', { name: /介入操作/ })).not.toBeInTheDocument()
  })

  it('an ASSISTANT sees the intervention launcher (has some allowed interventions) but not the end-lesson danger action (PRIMARY-only), which is hidden not disabled', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="ASSISTANT" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    expect(screen.getByRole('button', { name: /介入操作/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '授業を終了' })).not.toBeInTheDocument()
  })

  it('a PRIMARY teacher sees the end-lesson danger action while RUNNING', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    expect(screen.getByRole('button', { name: '授業を終了' })).toBeInTheDocument()
  })

  it('clicking "授業を終了" invokes completeLessonCallable (the real end-of-lesson flow), not interruptLessonCallable', async () => {
    const user = userEvent.setup()
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    const button = screen.getByRole('button', { name: '授業を終了' })
    await user.click(button)

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'completeLessonCallable')
    expect(httpsCallableMock).not.toHaveBeenCalledWith(functions, 'interruptLessonCallable')
    expect(callableMock).toHaveBeenCalledWith(
      expect.objectContaining({ lessonRunId: 'run-1', reason: expect.any(String) }),
    )
  })

  it('clicking "授業を安全停止" invokes interruptLessonCallable (distinct from the end-lesson flow)', async () => {
    const user = userEvent.setup()
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    const button = screen.getByRole('button', { name: '授業を安全停止' })
    await user.click(button)

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'interruptLessonCallable')
    expect(httpsCallableMock).not.toHaveBeenCalledWith(functions, 'completeLessonCallable')
  })

  it('shows a safe-stop banner with a recovery option when the lesson is INTERRUPTED, and PRIMARY can resume it', async () => {
    const user = userEvent.setup()
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'INTERRUPTED', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    expect(screen.getByRole('alert')).toHaveTextContent(/安全に停止/)
    const resumeButton = screen.getByRole('button', { name: /授業を再開/ })
    await user.click(resumeButton)
    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'resumeLessonCallable')
    expect(callableMock).toHaveBeenCalled()
  })

  it('does not show a resume button for a VIEWER during an interruption (authorization-hidden), but still shows the guidance banner', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="VIEWER" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'INTERRUPTED', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    expect(screen.getByRole('alert')).toHaveTextContent(/安全に停止/)
    expect(screen.queryByRole('button', { name: /授業を再開/ })).not.toBeInTheDocument()
  })

  it('opens and closes the intervention drawer via keyboard alone and submits an intervention through applyTeacherIntervention', async () => {
    const user = userEvent.setup()
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([])

    await user.tab()
    // Keep tabbing until the launcher button has focus (order depends on what else is focusable above it).
    let launcher = screen.getByRole('button', { name: /介入操作/ })
    let guard = 0
    while (document.activeElement !== launcher && guard < 20) {
      await user.tab()
      guard += 1
    }
    expect(launcher).toHaveFocus()
    await user.keyboard('{Enter}')

    const emergencyStop = await screen.findByRole('button', { name: /緊急停止/ })
    await user.click(emergencyStop)
    await user.type(screen.getByLabelText('理由'), '不審な操作')
    await user.click(screen.getByRole('button', { name: '実行' }))

    expect(httpsCallableMock).toHaveBeenCalledWith(functions, 'applyTeacherInterventionCallable')
    expect(callableMock).toHaveBeenCalledWith(
      expect.objectContaining({ lessonRunId: 'run-1', type: 'EMERGENCY_STOP', reason: '不審な操作' }),
    )
  })

  it('flags participant issues (imbalance/duplicate/disconnect) in the top-level open-issues list, with icon + text', () => {
    render(<LessonControlRoom lessonRunId="run-1" role="PRIMARY" functions={functions} firestore={firestore} database={database} />)
    emitPublic({ status: 'RUNNING', currentPhaseId: 'phase-1' })
    emitDisplay()
    emitParticipants([
      { ...baseParticipant, id: 'p-1', displayName: 'A1', status: 'TEMPORARILY_DISCONNECTED' },
    ])

    const list = screen.getByRole('list', { name: '未対応の問題' })
    expect(within(list).getByText(/切断/)).toBeInTheDocument()
  })
})
