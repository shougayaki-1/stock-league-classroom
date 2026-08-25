import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Database } from 'firebase/database'
import type { Firestore } from 'firebase/firestore'
import type { Functions } from 'firebase/functions'
import { LessonPreparationPage } from './LessonPreparationPage'
import type { LessonParticipantView } from '../../lib/lessonRuns/participants'
import type { LessonRunPublicState } from '../../lib/lessonRuns/liveTypes'

const transitionPhaseMock = vi.fn()
const issueJoinCodeMock = vi.fn()
const invalidateJoinCodeMock = vi.fn()
const issueDisplaySessionTokenMock = vi.fn()
let publicUpdateCallback: ((state: LessonRunPublicState | null) => void) | undefined
let participantsUpdateCallback: ((participants: LessonParticipantView[]) => void) | undefined

vi.mock('../../lib/lessonRuns/transitionPhase', () => ({
  transitionPhase: (...args: unknown[]) => transitionPhaseMock(...args),
}))

vi.mock('../../lib/lessonRuns/joinCodes', () => ({
  issueJoinCode: (...args: unknown[]) => issueJoinCodeMock(...args),
  invalidateJoinCode: (...args: unknown[]) => invalidateJoinCodeMock(...args),
}))

vi.mock('../../lib/lessonRuns/displaySession', () => ({
  issueDisplaySessionToken: (...args: unknown[]) => issueDisplaySessionTokenMock(...args),
}))

vi.mock('../../lib/lessonRuns/liveRepository', () => ({
  subscribePublicRun: vi.fn((_db, _runId, onUpdate) => {
    publicUpdateCallback = onUpdate
    return vi.fn()
  }),
}))

vi.mock('../../lib/lessonRuns/participants', () => ({
  subscribeLessonParticipants: vi.fn((_firestore, _runId, onUpdate) => {
    participantsUpdateCallback = onUpdate
    return vi.fn()
  }),
}))

const functions = {} as Functions
const firestore = {} as Firestore
const database = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  publicUpdateCallback = undefined
  participantsUpdateCallback = undefined
  transitionPhaseMock.mockResolvedValue({})
  issueJoinCodeMock.mockResolvedValue({ code: 'XYZ789' })
  invalidateJoinCodeMock.mockResolvedValue({ success: true })
  issueDisplaySessionTokenMock.mockResolvedValue({ token: 'mock-display-token' })
})

function renderPage(props: Partial<Parameters<typeof LessonPreparationPage>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/teacher/lessons/run-1/prepare']}>
      <Routes>
        <Route
          path="/teacher/lessons/:runId/prepare"
          element={
            <LessonPreparationPage
              lessonRunId="run-1"
              functions={functions}
              firestore={firestore}
              database={database}
              {...props}
            />
          }
        />
        <Route path="/teacher/lessons/:runId/control" element={<div>コントロール画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LessonPreparationPage', () => {
  it('renders preparation button for DRAFT status and performs 2 transitions + 2 token issues on click', async () => {
    const user = userEvent.setup()
    renderPage({ initialStatus: 'DRAFT' })

    const prepButton = screen.getByRole('button', { name: '授業の準備をする' })
    expect(prepButton).toBeInTheDocument()

    await user.click(prepButton)

    await waitFor(() => {
      // 1. DRAFT -> READY
      expect(transitionPhaseMock).toHaveBeenCalledWith(functions, expect.objectContaining({
        lessonRunId: 'run-1',
        targetStatus: 'READY',
      }))
      // 2. READY -> WAITING
      expect(transitionPhaseMock).toHaveBeenCalledWith(functions, expect.objectContaining({
        lessonRunId: 'run-1',
        targetStatus: 'WAITING',
      }))
      // 3. Issue join code
      expect(issueJoinCodeMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1' })
      // 4. Issue display session token
      expect(issueDisplaySessionTokenMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1' })
    })

    // Shows the issued join code and display URL buttons
    expect(await screen.findByText('XYZ789')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /教室表示を開く/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/display/run-1?token=mock-display-token'),
    )
    expect(screen.getByRole('button', { name: '表示用URLをコピー' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '授業を開始' })).toBeInTheDocument()
  })

  it('renders WAITING state with join code, participants, and reissuing controls', async () => {
    const user = userEvent.setup()
    renderPage({ initialStatus: 'WAITING', initialJoinCode: 'CODE12' })

    expect(screen.getByText('CODE12')).toBeInTheDocument()

    // Test live public update
    act(() => {
      publicUpdateCallback?.({
        status: 'WAITING',
        currentPhaseId: null,
        title: 'テスト授業タイトル',
        updatedAtMillis: 1000,
        orgId: 'org-1',
        currentPhaseLabel: null,
        currentPhaseEndsAtMillis: null,
        publicTask: null,
        notifications: [],
        teams: [],
        stocks: {},
        marketPaused: false,
        nextBatchAtMillis: null,
      })
    })
    expect(screen.getByText('テスト授業タイトル')).toBeInTheDocument()

    // Test live participants update
    act(() => {
      participantsUpdateCallback?.([
        {
          id: 'p-1',
          lessonRunId: 'run-1',
          orgId: 'org-1',
          authUid: 'uid-1',
          identityMode: 'SCHOOL_ACCOUNT',
          displayName: '生徒A',
          teamId: 't-1',
          status: 'ACTIVE',
          sessionVersion: 1,
        },
        {
          id: 'p-2',
          lessonRunId: 'run-1',
          orgId: 'org-1',
          authUid: 'uid-2',
          identityMode: 'SCHOOL_ACCOUNT',
          displayName: '生徒B',
          teamId: 't-2',
          status: 'ACTIVE',
          sessionVersion: 1,
        },
      ])
    })
    expect(screen.getByText('現在 2 人')).toBeInTheDocument()
    expect(screen.getByText('生徒A')).toBeInTheDocument()
    expect(screen.getByText('生徒B')).toBeInTheDocument()

    // Test reissuing code
    issueJoinCodeMock.mockResolvedValueOnce({ code: 'NEW456' })
    const reissueCodeBtn = screen.getByRole('button', { name: '参加コードを作り直す' })
    await user.click(reissueCodeBtn)

    await waitFor(() => {
      expect(invalidateJoinCodeMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1', code: 'CODE12' })
      expect(issueJoinCodeMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1' })
    })
    expect(await screen.findByText('NEW456')).toBeInTheDocument()

    // Test reissuing display token
    const issueDisplayBtn = screen.getByRole('button', { name: '表示用URLを発行する' })
    await user.click(issueDisplayBtn)
    await waitFor(() => {
      expect(issueDisplaySessionTokenMock).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1' })
    })
    expect(screen.getByRole('link', { name: /教室表示を開く/ })).toBeInTheDocument()
  })

  it('内部statusトークンをコピーに露出せず、参加者statusを人間向けラベルで表示する', async () => {
    renderPage({ initialStatus: 'DRAFT' })
    expect(screen.queryByText(/WAITING/)).not.toBeInTheDocument()

    renderPage({ initialStatus: 'WAITING', initialJoinCode: 'CODE12' })
    act(() => {
      participantsUpdateCallback?.([
        {
          id: 'p-1',
          lessonRunId: 'run-1',
          orgId: 'org-1',
          authUid: 'uid-1',
          identityMode: 'SCHOOL_ACCOUNT',
          displayName: '生徒A',
          teamId: 't-1',
          status: 'TEMPORARILY_DISCONNECTED',
          sessionVersion: 1,
        },
        {
          id: 'p-2',
          lessonRunId: 'run-1',
          orgId: 'org-1',
          authUid: 'uid-2',
          identityMode: 'SCHOOL_ACCOUNT',
          displayName: '生徒B',
          teamId: 't-2',
          status: 'UNKNOWN_PARTICIPANT_STATUS' as unknown as LessonParticipantView['status'],
          sessionVersion: 1,
        },
      ])
    })

    expect(screen.getByText('一時切断')).toBeInTheDocument()
    expect(screen.getByText('参加状態を確認できません')).toBeInTheDocument()
    expect(screen.queryByText('UNKNOWN_PARTICIPANT_STATUS')).not.toBeInTheDocument()
  })

  it('handles starting the lesson and navigates to control room', async () => {
    const user = userEvent.setup()
    renderPage({ initialStatus: 'WAITING', initialJoinCode: 'CODE12' })

    const startLessonBtn = screen.getByRole('button', { name: '授業を開始' })
    await user.click(startLessonBtn)

    await waitFor(() => {
      expect(transitionPhaseMock).toHaveBeenCalledWith(functions, expect.objectContaining({
        lessonRunId: 'run-1',
        targetStatus: 'RUNNING',
      }))
      expect(transitionPhaseMock).toHaveBeenCalledWith(functions, expect.objectContaining({
        lessonRunId: 'run-1',
        targetPhaseId: 'intro',
      }))
    })

    expect(await screen.findByText('コントロール画面')).toBeInTheDocument()
  })

  it('redirects to control room immediately if status is RUNNING', () => {
    renderPage({ initialStatus: 'RUNNING' })
    expect(screen.getByText('コントロール画面')).toBeInTheDocument()
  })
})
