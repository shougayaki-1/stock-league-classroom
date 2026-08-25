import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InterventionPanel } from './InterventionPanel'
import type { LessonTeamView } from '../../lib/lessonRuns/teams'
import type { LessonResponseView } from '../../lib/lessonRuns/teacherResponses'

const defaultProps = {
  open: true,
  role: 'PRIMARY' as const,
  currentPhaseId: 'phase-market',
  phaseHasTimer: true,
  displayModeOverride: null,
  informationItems: [] as Array<{ id: string; body: string }>,
  hiddenInformationIds: [] as string[],
  participants: [] as Array<{ id: string; displayName: string }>,
  teams: [] as LessonTeamView[],
  responses: [] as LessonResponseView[],
  functions: {} as never,
  lessonRunId: 'run-1',
  onClose: vi.fn(),
  onApply: vi.fn(),
}

describe('InterventionPanel', () => {
  it('PRIMARY sees all 9 intervention types', () => {
    render(<InterventionPanel {...defaultProps} />)
    for (const label of ['時間を延ばす', '代理確定', '代表者変更', '参加者の再接続', '教室表示の画面を切り替える', '名前を直す', '前フェーズへ復元', '緊急停止', '情報を隠す']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('ASSISTANT does not even render PRIMARY-only interventions (authorization-driven omission, not disabled)', () => {
    render(<InterventionPanel {...defaultProps} role="ASSISTANT" />)
    // Allowed for ASSISTANT.
    expect(screen.getByRole('button', { name: /代理確定/ })).toBeInTheDocument()
    // PRIMARY-only: must not be in the DOM at all.
    expect(screen.queryByRole('button', { name: /名前を直す/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /前フェーズへ復元/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /緊急停止/ })).not.toBeInTheDocument()
    expect(screen.queryByText('名前を直す')).not.toBeInTheDocument()
  })

  it('VIEWER sees no executable intervention and instead sees an explanatory message', () => {
    render(<InterventionPanel {...defaultProps} role="VIEWER" />)
    expect(screen.queryByRole('button', { name: /時間を延ばす/ })).not.toBeInTheDocument()
    expect(screen.getByText(/実行できる操作はありません/)).toBeInTheDocument()
  })

  it('lets a PRIMARY teacher fill in a reason, then submit EMERGENCY_STOP via confirmation button', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<InterventionPanel {...defaultProps} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /緊急停止/ }))
    const reasonField = screen.getByLabelText('理由')
    await user.type(reasonField, '不審な操作を検知')
    await user.click(screen.getByRole('button', { name: '授業を緊急停止する' }))

    expect(onApply).toHaveBeenCalledWith({ type: 'EMERGENCY_STOP', reason: '不審な操作を検知', detail: {} })
  })

  it('uses bespoke ProxyConfirmForm for PROXY_CONFIRM and submits detail + impactScope from it (no manual ID entry)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const responses = [{
      id: 'response-1', participantId: 'p-1', phaseId: 'phase-market', inputId: 'input-1', status: 'APPROVED' as const,
    }]
    render(<InterventionPanel
      {...defaultProps}
      participants={[{ id: 'p-1', displayName: 'やまだ' }]}
      responses={responses}
      onApply={onApply}
    />)

    await user.click(screen.getByRole('button', { name: /代理確定/ }))
    await user.type(screen.getByLabelText('理由'), '生徒からの要望')
    expect(screen.queryByLabelText('フェーズID')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('対象参加者ID')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /やまだ/ }))
    await user.click(screen.getByRole('button', { name: 'この内容で確定する' }))

    expect(onApply).toHaveBeenCalledWith({
      type: 'PROXY_CONFIRM',
      reason: '生徒からの要望',
      detail: { phaseId: 'phase-market', inputId: 'input-1', onBehalfOfParticipantId: 'p-1' },
      impactScope: { level: 'PARTICIPANT', participantId: 'p-1' },
    })
  })

  it('uses bespoke ChangeRepresentativeForm for CHANGE_REPRESENTATIVE and submits detail + TEAM impactScope (no manual ID entry)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const teams = [{
      id: 'team-1', displayName: 'Aチーム',
      memberParticipantIds: ['p-1', 'p-2'], representativeParticipantId: 'p-1',
      confirmationMode: 'REPRESENTATIVE' as const,
    }]
    render(<InterventionPanel
      {...defaultProps}
      teams={teams}
      participants={[{ id: 'p-1', displayName: 'たなか' }, { id: 'p-2', displayName: 'すずき' }]}
      onApply={onApply}
    />)

    await user.click(screen.getByRole('button', { name: /代表者変更/ }))
    await user.type(screen.getByLabelText('理由'), 'チームの都合により');
    expect(screen.queryByLabelText('チームID')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('新代表者の参加者ID')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aチーム' }))
    await user.click(screen.getByRole('button', { name: 'すずき' }))

    expect(onApply).toHaveBeenCalledWith({
      type: 'CHANGE_REPRESENTATIVE',
      reason: 'チームの都合により',
      detail: { teamId: 'team-1', newRepresentativeParticipantId: 'p-2' },
      impactScope: { level: 'TEAM', teamId: 'team-1' },
    })
  })

  it('uses bespoke form for EXTEND_TIME and submits it', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<InterventionPanel {...defaultProps} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /時間を延ばす/ }))
    await user.type(screen.getByLabelText('理由'), '生徒からの要望')
    await user.click(screen.getByRole('button', { name: '+3分' }))

    expect(onApply).toHaveBeenCalledWith({
      type: 'EXTEND_TIME', reason: '生徒からの要望', detail: { phaseId: 'phase-market', additionalSeconds: 180 },
    })
  })
})
