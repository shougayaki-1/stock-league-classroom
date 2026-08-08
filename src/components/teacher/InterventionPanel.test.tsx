import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InterventionPanel } from './InterventionPanel'

describe('InterventionPanel', () => {
  it('PRIMARY sees all 9 intervention types', () => {
    render(<InterventionPanel open role="PRIMARY" onClose={vi.fn()} onApply={vi.fn()} />)
    for (const label of ['時間延長', '代理確定', '代表者変更', '参加者の再接続', '教室表示の切り替え', '状態の手動修正', '前フェーズへ復元', '緊急停止', '情報の非表示化']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('ASSISTANT does not even render PRIMARY-only interventions (authorization-driven omission, not disabled)', () => {
    render(<InterventionPanel open role="ASSISTANT" onClose={vi.fn()} onApply={vi.fn()} />)
    // Allowed for ASSISTANT.
    expect(screen.getByRole('button', { name: /代理確定/ })).toBeInTheDocument()
    // PRIMARY-only: must not be in the DOM at all.
    expect(screen.queryByRole('button', { name: /状態の手動修正/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /前フェーズへ復元/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /緊急停止/ })).not.toBeInTheDocument()
    expect(screen.queryByText('状態の手動修正')).not.toBeInTheDocument()
  })

  it('VIEWER sees no executable intervention and instead sees an explanatory message', () => {
    render(<InterventionPanel open role="VIEWER" onClose={vi.fn()} onApply={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /時間延長/ })).not.toBeInTheDocument()
    expect(screen.getByText(/実行できる操作はありません/)).toBeInTheDocument()
  })

  it('lets a PRIMARY teacher fill in a reason and detail fields, then submit EMERGENCY_STOP (no detail fields) via keyboard', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<InterventionPanel open role="PRIMARY" onClose={vi.fn()} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /緊急停止/ }))
    const reasonField = screen.getByLabelText('理由')
    await user.type(reasonField, '不審な操作を検知')
    await user.click(screen.getByRole('button', { name: '実行' }))

    expect(onApply).toHaveBeenCalledWith({ type: 'EMERGENCY_STOP', reason: '不審な操作を検知', detail: {} })
  })

  it('collects per-type detail fields for EXTEND_TIME and submits them', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<InterventionPanel open role="PRIMARY" onClose={vi.fn()} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /時間延長/ }))
    await user.type(screen.getByLabelText('理由'), '生徒からの要望')
    await user.type(screen.getByLabelText('フェーズID'), 'phase-2')
    await user.type(screen.getByLabelText('延長秒数'), '60')
    await user.click(screen.getByRole('button', { name: '実行' }))

    expect(onApply).toHaveBeenCalledWith({
      type: 'EXTEND_TIME', reason: '生徒からの要望', detail: { phaseId: 'phase-2', additionalSeconds: '60' },
    })
  })
})
