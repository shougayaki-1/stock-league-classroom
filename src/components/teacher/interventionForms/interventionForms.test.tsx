import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtendTimeForm } from './ExtendTimeForm'
import { DisplayModeForm } from './DisplayModeForm'
import { HideInformationForm } from './HideInformationForm'
import { CorrectStateForm } from './CorrectStateForm'
import { ProxyConfirmForm } from './ProxyConfirmForm'
import { ChangeRepresentativeForm } from './ChangeRepresentativeForm'
import { ReconnectParticipantForm } from './ReconnectParticipantForm'
import { RestorePreviousPhaseForm } from './RestorePreviousPhaseForm'
import { issueRecoveryCode } from '../../../lib/lessonRuns/recovery'

vi.mock('../../../lib/lessonRuns/recovery', () => ({
  issueRecoveryCode: vi.fn(),
}))

describe('ExtendTimeForm', () => {
  it('+3分でフェーズIDと秒数を組み立てる', async () => {
    const onSubmit = vi.fn()
    render(<ExtendTimeForm currentPhaseId="phase-market" hasTimer onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '+3分' }))

    expect(onSubmit).toHaveBeenCalledWith({ phaseId: 'phase-market', additionalSeconds: 180 })
  })

  it('制限時間の無いフェーズでは理由を示して操作を出さない', () => {
    render(<ExtendTimeForm currentPhaseId="phase-discussion" hasTimer={false} onSubmit={vi.fn()} />)

    expect(screen.getByText('このフェーズには制限時間がありません。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+3分' })).not.toBeInTheDocument()
  })

  it('フェーズIDの手入力欄を持たない', () => {
    render(<ExtendTimeForm currentPhaseId="phase-market" hasTimer onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('フェーズID')).not.toBeInTheDocument()
  })
})

describe('DisplayModeForm', () => {
  it('選んだ画面を displayMode として渡す', async () => {
    const onSubmit = vi.fn()
    render(<DisplayModeForm currentOverride={null} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '解説の画面' }))

    expect(onSubmit).toHaveBeenCalledWith({ displayMode: 'EXPLANATION' })
  })

  it('自動に戻すで null を渡す', async () => {
    const onSubmit = vi.fn()
    render(<DisplayModeForm currentOverride="EXPLANATION" onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '自動に戻す' }))

    expect(onSubmit).toHaveBeenCalledWith({ displayMode: null })
  })

  it('上書きが無いときは自動に戻すを出さない', () => {
    render(<DisplayModeForm currentOverride={null} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '自動に戻す' })).not.toBeInTheDocument()
  })
})

describe('HideInformationForm', () => {
  const items = [
    { id: 'info-1', body: '新製品を発表' },
    { id: 'info-2', body: '工場が停止' },
  ]

  it('公開中のニュースを非表示にする', async () => {
    const onSubmit = vi.fn()
    render(<HideInformationForm informationItems={items} hiddenInformationIds={[]} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '「工場が停止」を非表示にする' }))

    expect(onSubmit).toHaveBeenCalledWith({ informationId: 'info-2', hidden: true })
  })

  it('非表示中のニュースを元に戻す', async () => {
    const onSubmit = vi.fn()
    render(<HideInformationForm informationItems={items} hiddenInformationIds={['info-1']} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '「新製品を発表」を元に戻す' }))

    expect(onSubmit).toHaveBeenCalledWith({ informationId: 'info-1', hidden: false })
  })

  it('情報IDの手入力欄を持たない', () => {
    render(<HideInformationForm informationItems={items} hiddenInformationIds={[]} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('情報ID')).not.toBeInTheDocument()
  })
})

describe('CorrectStateForm', () => {
  const participants = [{ id: 'p1', displayName: 'やまだ' }]
  const teams = [{ teamId: 'team-a', displayName: 'Aチーム' }]

  it('チーム名の修正を組み立てる', async () => {
    const onSubmit = vi.fn()
    render(<CorrectStateForm participants={participants} teams={teams} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'チーム名' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aチーム' }))
    const field = screen.getByLabelText('新しい名前')
    await userEvent.clear(field)
    await userEvent.type(field, 'Bチーム')
    await userEvent.click(screen.getByRole('button', { name: 'この名前に直す' }))

    expect(onSubmit).toHaveBeenCalledWith({
      target: 'TEAM_DISPLAY_NAME', targetId: 'team-a', displayName: 'Bチーム',
    })
  })

  it('対象パスの手入力欄を持たない', () => {
    render(<CorrectStateForm participants={participants} teams={teams} onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText('対象パス')).not.toBeInTheDocument()
  })

  it('表示名が空のときIDを表示せず固定の代替文言を出す。送信時は実IDを渡す', async () => {
    const onSubmit = vi.fn()
    const blankParticipants = [{ id: 'participant-secret-id', displayName: '' }]
    const blankTeams = [{ teamId: 'team-secret-id', displayName: '' }]
    render(<CorrectStateForm participants={blankParticipants} teams={blankTeams} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '生徒の表示名' }))
    expect(screen.queryByText('participant-secret-id')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '生徒名を確認できません' }))
    const field = screen.getByLabelText('新しい名前')
    await userEvent.clear(field)
    await userEvent.type(field, 'たろう')
    await userEvent.click(screen.getByRole('button', { name: 'この名前に直す' }))

    expect(screen.queryByText('participant-secret-id')).not.toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledWith({
      target: 'PARTICIPANT_DISPLAY_NAME', targetId: 'participant-secret-id', displayName: 'たろう',
    })
  })
})

describe('ProxyConfirmForm', () => {
  const phases = [{ id: 'phase-sentinel-999', displayConfig: { label: '市場フェーズ' } }]
  const participants = [
    { id: 'participant-sentinel-abc', displayName: 'やまだ' },
    { id: 'participant-rep-1', displayName: 'たなか（代表）' },
    { id: 'participant-member-2', displayName: 'すずき' },
  ]
  const teams = [
    {
      id: 'team-sentinel-xyz',
      displayName: 'Aチーム',
      memberParticipantIds: ['participant-rep-1', 'participant-member-2'],
      representativeParticipantId: 'participant-rep-1',
      confirmationMode: 'REPRESENTATIVE' as const,
    },
    {
      id: 'team-quorum',
      displayName: 'Bチーム',
      memberParticipantIds: ['participant-rep-1', 'participant-member-2'],
      representativeParticipantId: 'participant-rep-1',
      confirmationMode: 'QUORUM' as const,
    },
  ]

  it('sentinelなIDをDOMに一切出さないが、送信ペイロードには含める（個人の回答）', async () => {
    const onSubmit = vi.fn()
    const responses = [{
      id: 'response-sentinel-111',
      participantId: 'participant-sentinel-abc',
      phaseId: 'phase-sentinel-999',
      inputId: 'input-secret-id',
      status: 'APPROVED' as const,
    }]
    render(<ProxyConfirmForm responses={responses} participants={participants} teams={teams} phases={phases} onSubmit={onSubmit} />)

    expect(screen.getByText('市場フェーズ・やまだ')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '市場フェーズ・やまだ' }))
    await userEvent.click(screen.getByRole('button', { name: 'この内容で確定する' }))

    const body = document.body.textContent ?? ''
    for (const sentinel of ['response-sentinel-111', 'participant-sentinel-abc', 'phase-sentinel-999', 'input-secret-id']) {
      expect(body).not.toContain(sentinel)
    }

    expect(onSubmit).toHaveBeenCalledWith(
      { phaseId: 'phase-sentinel-999', inputId: 'input-secret-id', onBehalfOfParticipantId: 'participant-sentinel-abc' },
      { level: 'PARTICIPANT', participantId: 'participant-sentinel-abc' },
    )
  })

  it('承認済み以外の回答は選択肢に出さない', () => {
    const responses = [
      { id: 'r1', participantId: 'participant-sentinel-abc', phaseId: 'phase-sentinel-999', inputId: 'i1', status: 'PROPOSED' as const },
      { id: 'r2', participantId: 'participant-sentinel-abc', phaseId: 'phase-sentinel-999', inputId: 'i2', status: 'DRAFT' as const },
    ]
    render(<ProxyConfirmForm responses={responses} participants={participants} teams={teams} phases={phases} onSubmit={vi.fn()} />)
    expect(screen.getByText('確定できる承認済みの回答がありません。')).toBeInTheDocument()
  })

  it('REPRESENTATIVEモードのチーム回答は代表者を自動選択し追加の選択を求めない', async () => {
    const onSubmit = vi.fn()
    const responses = [{
      id: 'response-team-1', teamId: 'team-sentinel-xyz', phaseId: 'phase-sentinel-999', inputId: 'input-team-1', status: 'APPROVED' as const,
    }]
    render(<ProxyConfirmForm responses={responses} participants={participants} teams={teams} phases={phases} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '市場フェーズ・Aチーム' }))
    expect(screen.getByText('たなか（代表） に代わってこの回答を確定します。よろしいですか？')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この内容で確定する' }))

    expect(onSubmit).toHaveBeenCalledWith(
      { phaseId: 'phase-sentinel-999', inputId: 'input-team-1', onBehalfOfParticipantId: 'participant-rep-1' },
      { level: 'TEAM', teamId: 'team-sentinel-xyz' },
    )
  })

  it('QUORUMモードのチーム回答は教師がメンバーを表示名で選ぶ', async () => {
    const onSubmit = vi.fn()
    const responses = [{
      id: 'response-team-2', teamId: 'team-quorum', phaseId: 'phase-sentinel-999', inputId: 'input-team-2', status: 'APPROVED' as const,
    }]
    render(<ProxyConfirmForm responses={responses} participants={participants} teams={teams} phases={phases} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: '市場フェーズ・Bチーム' }))
    expect(screen.getByRole('button', { name: 'たなか（代表）' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'すずき' }))
    await userEvent.click(screen.getByRole('button', { name: 'この内容で確定する' }))

    expect(onSubmit).toHaveBeenCalledWith(
      { phaseId: 'phase-sentinel-999', inputId: 'input-team-2', onBehalfOfParticipantId: 'participant-member-2' },
      { level: 'TEAM', teamId: 'team-quorum' },
    )
  })
})

describe('ChangeRepresentativeForm', () => {
  const participants = [
    { id: 'participant-rep-sentinel', displayName: 'たなか（代表）' },
    { id: 'participant-cand-sentinel', displayName: 'すずき' },
    { id: 'participant-lone-sentinel', displayName: 'ひとりだけ' },
  ]

  it('sentinelなteamId/participantIdをDOMに一切出さないが、送信ペイロードには含める', async () => {
    const onSubmit = vi.fn()
    const teams = [{
      id: 'team-sentinel-777',
      displayName: 'Aチーム',
      memberParticipantIds: ['participant-rep-sentinel', 'participant-cand-sentinel'],
      representativeParticipantId: 'participant-rep-sentinel',
      confirmationMode: 'REPRESENTATIVE' as const,
    }]
    render(<ChangeRepresentativeForm teams={teams} participants={participants} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Aチーム' }))
    expect(screen.queryByRole('button', { name: 'たなか（代表）' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'すずき' }))

    const body = document.body.textContent ?? ''
    for (const sentinel of ['team-sentinel-777', 'participant-rep-sentinel', 'participant-cand-sentinel']) {
      expect(body).not.toContain(sentinel)
    }

    expect(onSubmit).toHaveBeenCalledWith({
      teamId: 'team-sentinel-777', newRepresentativeParticipantId: 'participant-cand-sentinel',
    })
  })

  it('候補が現在の代表者しかいないチームは理由を示し送信を無効化する', async () => {
    const onSubmit = vi.fn()
    const teams = [{
      id: 'team-lone',
      displayName: 'Bチーム',
      memberParticipantIds: ['participant-lone-sentinel'],
      representativeParticipantId: 'participant-lone-sentinel',
      confirmationMode: 'REPRESENTATIVE' as const,
    }]
    render(<ChangeRepresentativeForm teams={teams} participants={participants} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bチーム' }))

    expect(screen.getByText('Bチームには現在の代表者以外のメンバーがいないため、代表者を変更できません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この代表者に変更する' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('ReconnectParticipantForm', () => {
  const fakeFunctions = {} as never

  it('生徒を選んで発行すると issueRecoveryCode を正しい引数で呼び、コードのみ表示し参加者IDはDOMに出さない', async () => {
    const mockIssue = vi.mocked(issueRecoveryCode)
    mockIssue.mockResolvedValue({ code: 'SENTINEL-CODE-1234', deduplicated: false })

    const participants = [
      { id: 'participant-secret-id', displayName: 'たなか', status: 'TEMPORARILY_DISCONNECTED' },
      { id: 'participant-other', displayName: 'すずき', status: 'ACTIVE' },
    ]

    render(
      <ReconnectParticipantForm
        functions={fakeFunctions}
        lessonRunId="run-sentinel-1"
        participants={participants}
        generateIdempotencyKey={() => 'idem-key-1'}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /たなか/ }))
    await userEvent.click(screen.getByRole('button', { name: '再接続コードを発行する' }))

    expect(await screen.findByText('SENTINEL-CODE-1234')).toBeInTheDocument()

    expect(mockIssue).toHaveBeenCalledWith(fakeFunctions, {
      lessonRunId: 'run-sentinel-1',
      participantId: 'participant-secret-id',
      idempotencyKey: 'idem-key-1',
    })

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('participant-secret-id')
    expect(body).not.toContain('participant-other')
    expect(body).toContain('SENTINEL-CODE-1234')
  })

  it('発行に失敗した場合は describeError 経由の安全なメッセージを表示し、生の error.message は出さない', async () => {
    const mockIssue = vi.mocked(issueRecoveryCode)
    mockIssue.mockRejectedValue({ code: 'functions/internal', message: 'raw internal leak detail' })

    const participants = [{ id: 'participant-secret-id-2', displayName: 'やまだ', status: 'ACTIVE' }]

    render(
      <ReconnectParticipantForm
        functions={fakeFunctions}
        lessonRunId="run-sentinel-2"
        participants={participants}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /やまだ/ }))
    await userEvent.click(screen.getByRole('button', { name: '再接続コードを発行する' }))

    await screen.findByRole('alert')

    const body = document.body.textContent ?? ''
    expect(body).not.toContain('raw internal leak detail')
    expect(body).not.toContain('participant-secret-id-2')
  })
})

describe('RestorePreviousPhaseForm', () => {
  const phases = [
    { id: 'phase-intro-sentinel', displayConfig: { label: '導入' } },
    { id: 'phase-market-sentinel', displayConfig: { label: '市場' } },
    { id: 'phase-discussion-sentinel', displayConfig: { label: '討論' } },
    { id: 'phase-reflection-sentinel', displayConfig: { label: '振り返り' } },
  ]

  it('現在フェーズより前のフェーズだけを候補にし、targetPhaseId とLESSONスコープで送信する。フェーズIDはDOMに出さない', async () => {
    const onSubmit = vi.fn()
    render(
      <RestorePreviousPhaseForm
        phases={phases}
        currentPhaseId="phase-discussion-sentinel"
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('button', { name: '導入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '市場' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '討論' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '振り返り' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '市場' }))

    expect(onSubmit).toHaveBeenCalledWith({ targetPhaseId: 'phase-market-sentinel' }, { level: 'LESSON' })

    const body = document.body.textContent ?? ''
    for (const sentinel of ['phase-intro-sentinel', 'phase-market-sentinel', 'phase-discussion-sentinel', 'phase-reflection-sentinel']) {
      expect(body).not.toContain(sentinel)
    }
  })

  it('最初のフェーズでは戻せる候補がないことを示す', () => {
    render(
      <RestorePreviousPhaseForm
        phases={phases}
        currentPhaseId="phase-intro-sentinel"
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText('戻せる前のフェーズがありません。')).toBeInTheDocument()
  })

  it('ラベルの無いフェーズは確認できないラベルを表示する', () => {
    const onSubmit = vi.fn()
    render(
      <RestorePreviousPhaseForm
        phases={[{ id: 'phase-nolabel' }, { id: 'phase-current' }]}
        currentPhaseId="phase-current"
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByRole('button', { name: 'フェーズ名を確認できません' })).toBeInTheDocument()
  })
})
