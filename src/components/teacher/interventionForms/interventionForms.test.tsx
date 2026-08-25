import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtendTimeForm } from './ExtendTimeForm'
import { DisplayModeForm } from './DisplayModeForm'
import { HideInformationForm } from './HideInformationForm'
import { CorrectStateForm } from './CorrectStateForm'

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
