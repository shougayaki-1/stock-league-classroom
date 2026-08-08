import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Auth } from 'firebase/auth'
import type { Functions } from 'firebase/functions'
import type { Database } from 'firebase/database'
import { ClassroomDisplayPage } from './ClassroomDisplayPage'
import type { LessonRunDisplayState } from '../../lib/lessonRuns/liveTypes'
import type { Unsubscribe } from '../../lib/lessonRuns/liveRepository'

const auth = {} as Auth
const functions = {} as Functions
const database = {} as Database

let onUpdateCallback: ((state: LessonRunDisplayState | null) => void) | undefined
let onErrorCallback: ((error: Error) => void) | undefined
const unsubscribeMock = vi.fn()
const subscribeMock = vi.fn((_database: Database, _lessonRunId: string, onUpdate: (state: LessonRunDisplayState | null) => void, onError?: (error: Error) => void): Unsubscribe => {
  onUpdateCallback = onUpdate
  onErrorCallback = onError
  return unsubscribeMock
})
const signInMock = vi.fn().mockResolvedValue({ user: { uid: 'display-run-1' } })

beforeEach(() => {
  onUpdateCallback = undefined
  onErrorCallback = undefined
  unsubscribeMock.mockReset()
  subscribeMock.mockClear()
  signInMock.mockClear()
  signInMock.mockResolvedValue({ user: { uid: 'display-run-1' } })
})

const baseState: LessonRunDisplayState = {
  orgId: 'org-1',
  mode: 'START',
  title: '株価変動を体験しよう',
  goal: '需給とニュースの関係を理解する',
  teams: [{ teamId: 't1', displayName: 'チームA', publicAggregateLabel: '1位' }],
  teacherGuidance: null,
  updatedAtMillis: 1000,
}

function renderPage(overrides: Partial<Parameters<typeof ClassroomDisplayPage>[0]> = {}) {
  return render(
    <ClassroomDisplayPage
      auth={auth}
      functions={functions}
      database={database}
      lessonRunId="run-1"
      token="plain-token"
      signIn={signInMock}
      subscribe={subscribeMock}
      {...overrides}
    />,
  )
}

describe('ClassroomDisplayPage — sign-in and subscription flow', () => {
  it('exchanges the token for a custom-token sign-in, then subscribes to lessonRunDisplay only after sign-in succeeds', async () => {
    renderPage()

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith(auth, functions, { lessonRunId: 'run-1', token: 'plain-token' }))
    await waitFor(() => expect(subscribeMock).toHaveBeenCalledWith(database, 'run-1', expect.any(Function), expect.any(Function)))

    // The plaintext token must never appear anywhere in the rendered DOM.
    expect(screen.queryByText('plain-token')).not.toBeInTheDocument()
  })

  it('shows an error state (not a raw stack trace) when the token exchange fails, and never subscribes', async () => {
    signInMock.mockRejectedValue(new Error('Display session token has expired'))
    renderPage()

    await waitFor(() => expect(screen.getByText(/表示できません|エラー|期限切れ/)).toBeInTheDocument())
    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    unmount()
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('surfaces a friendly message (not a crash) when the RTDB subscription itself errors (e.g. permission-denied)', async () => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    act(() => onErrorCallback?.(new Error('permission-denied')))
    await waitFor(() => expect(screen.getByText(/表示できません|エラー/)).toBeInTheDocument())
  })
})

describe('ClassroomDisplayPage — mode-based rendering', () => {
  it('renders StartSlide (title/goal) for mode START', async () => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    act(() => onUpdateCallback?.(baseState))
    expect(await screen.findByRole('heading', { name: baseState.title })).toBeInTheDocument()
    expect(screen.getByText(baseState.goal!)).toBeInTheDocument()
  })

  it('renders LiveSlide (team aggregates) for mode LIVE', async () => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    act(() => onUpdateCallback?.({ ...baseState, mode: 'LIVE', teacherGuidance: '前を見てください' }))
    expect(await screen.findByText('チームA')).toBeInTheDocument()
    expect(screen.getByText('前を見てください')).toBeInTheDocument()
  })

  it('renders EndSlide (results) for mode END', async () => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    act(() => onUpdateCallback?.({ ...baseState, mode: 'END' }))
    expect(await screen.findByText('結果・ランキング')).toBeInTheDocument()
    expect(screen.getByText('1位')).toBeInTheDocument()
  })

  it('renders ExplanationSlide for mode EXPLANATION and remembers the previous LIVE mode across the switch, resuming LIVE correctly afterward', async () => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())

    act(() => onUpdateCallback?.({ ...baseState, mode: 'LIVE' }))
    expect(await screen.findByText('チームA')).toBeInTheDocument()

    act(() => onUpdateCallback?.({ ...baseState, mode: 'EXPLANATION', teacherGuidance: '補足します' }))
    expect(await screen.findByText('補足します')).toBeInTheDocument()
    expect(screen.getByText(/授業中の画面に戻ります/)).toBeInTheDocument()

    act(() => onUpdateCallback?.({ ...baseState, mode: 'LIVE', teacherGuidance: null }))
    await waitFor(() => expect(screen.queryByText(/授業中の画面に戻ります/)).not.toBeInTheDocument())
    expect(screen.getByText('チームA')).toBeInTheDocument()
  })
})

describe('ClassroomDisplayPage — forbidden-information regression', () => {
  // A defense-in-depth check: even if a buggy/compromised writer put extra
  // fields onto the lessonRunDisplay RTDB node (student real names,
  // unsubmitted-participant lists, individual answers, future price info,
  // correct answers, internal coefficients, the random seed, teacher-only
  // settings, or per-student evaluations), this page must never render them
  // — it explicitly destructures only the allow-listed LessonRunDisplayState
  // fields before handing data to any Slide component.
  const forbidden = {
    realName: '山田太郎',
    unsubmittedParticipants: ['佐藤', '鈴木'],
    individualAnswers: { p1: '選択肢B' },
    futureInfo: '次のフェーズでA社の株価が急騰します',
    correctAnswer: '選択肢C',
    internalCoefficient: 0.42,
    randomSeed: 'seed-abc123',
    teacherOnlySettings: { difficulty: 'hard' },
    individualEvaluation: { p1: 'S評価' },
  }

  it.each(['START', 'LIVE', 'END', 'EXPLANATION'] as const)('never renders forbidden fields in mode %s', async (mode) => {
    renderPage()
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled())
    const contaminated = { ...baseState, mode, ...forbidden } as unknown as LessonRunDisplayState
    act(() => onUpdateCallback?.(contaminated))
    await screen.findByText(baseState.title)

    const dom = document.body.textContent ?? ''
    expect(dom).not.toContain('山田太郎')
    expect(dom).not.toContain('佐藤')
    expect(dom).not.toContain('選択肢B')
    expect(dom).not.toContain('次のフェーズでA社の株価が急騰します')
    expect(dom).not.toContain('選択肢C')
    expect(dom).not.toContain('0.42')
    expect(dom).not.toContain('seed-abc123')
    expect(dom).not.toContain('hard')
    expect(dom).not.toContain('S評価')
  })
})
