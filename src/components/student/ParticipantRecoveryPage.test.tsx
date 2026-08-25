import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantRecoveryPage } from './ParticipantRecoveryPage'
import { recoverParticipant } from '../../lib/lessonRuns/recovery'
import { getOrCreateStudentUid } from '../../lib/auth/studentAuth'

vi.mock('../../lib/lessonRuns/recovery', async () => {
  const actual = await vi.importActual<typeof import('../../lib/lessonRuns/recovery')>('../../lib/lessonRuns/recovery')
  return { ...actual, recoverParticipant: vi.fn() }
})
vi.mock('../../lib/auth/studentAuth', () => ({
  getOrCreateStudentUid: vi.fn(),
}))

describe('ParticipantRecoveryPage', () => {
  const fakeFunctions = {} as never
  const fakeAuth = {} as never

  it('コード入力→送信で、先に匿名認証を確立してから recoverParticipant を正しい引数で呼び、成功時に onRecovered する', async () => {
    vi.mocked(getOrCreateStudentUid).mockResolvedValue('new-device-uid')
    vi.mocked(recoverParticipant).mockResolvedValue({
      participantId: 'participant-secret-id', lessonRunId: 'run-sentinel', orgId: 'org-1',
      oldAuthUid: 'old-uid', newAuthUid: 'new-device-uid', previousStatus: 'TEMPORARILY_DISCONNECTED',
      sessionVersion: 1, membershipVersion: 1, deduplicated: false,
    })
    const onRecovered = vi.fn()

    render(
      <ParticipantRecoveryPage
        lessonRunId="run-sentinel"
        functions={fakeFunctions}
        auth={fakeAuth}
        generateIdempotencyKey={() => 'idem-key-recover-1'}
        onRecovered={onRecovered}
      />,
    )

    await userEvent.type(screen.getByLabelText('再接続コード'), 'SENTINEL-CODE-9999')
    await userEvent.click(screen.getByRole('button', { name: '再接続する' }))

    expect(await vi.waitFor(() => { expect(onRecovered).toHaveBeenCalled(); return true })).toBe(true)

    expect(getOrCreateStudentUid).toHaveBeenCalledWith(fakeAuth)
    expect(recoverParticipant).toHaveBeenCalledWith(fakeFunctions, {
      lessonRunId: 'run-sentinel',
      code: 'SENTINEL-CODE-9999',
      idempotencyKey: 'idem-key-recover-1',
    })

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('participant-secret-id')
  })

  it('失敗時は安全な日本語メッセージを表示し、生の error.message は出さない', async () => {
    vi.mocked(getOrCreateStudentUid).mockResolvedValue('new-device-uid')
    vi.mocked(recoverParticipant).mockRejectedValue({ code: 'functions/failed-precondition', message: 'raw internal detail leak' })
    const onRecovered = vi.fn()

    render(
      <ParticipantRecoveryPage
        lessonRunId="run-sentinel-2"
        functions={fakeFunctions}
        auth={fakeAuth}
        onRecovered={onRecovered}
      />,
    )

    await userEvent.type(screen.getByLabelText('再接続コード'), 'BAD-CODE')
    await userEvent.click(screen.getByRole('button', { name: '再接続する' }))

    await screen.findByRole('alert')
    expect(screen.getByText('このコードはすでに使用済みか、期限が切れています。教師に新しいコードを発行してもらってください。')).toBeInTheDocument()

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('raw internal detail leak')
    expect(onRecovered).not.toHaveBeenCalled()
  })
})
