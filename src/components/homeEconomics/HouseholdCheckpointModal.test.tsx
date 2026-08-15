import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  HouseholdCheckpointModal,
} from './HouseholdCheckpointModal'
import type { HouseholdCheckpointManifest } from '../../lib/homeEconomics/teacherDashboard'

const makeManifest = (id: string, label: string): HouseholdCheckpointManifest => ({
  checkpointId: id,
  kind: 'MANUAL',
  label,
  expectedRoundIndex: 1,
  createdAtServerMillis: 1000,
  createdByUid: 'teacher-1',
  restoreGeneration: 0,
})

describe('HouseholdCheckpointModal', () => {
  it('allows saving manual checkpoint with valid label', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onRestore = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <HouseholdCheckpointModal
        isOpen={true}
        onClose={onClose}
        checkpoints={[]}
        onSaveManualCheckpoint={onSave}
        onRestoreCheckpoint={onRestore}
        isSubmitting={false}
      />,
    )

    const labelInput = screen.getByPlaceholderText('例: 第2ラウンド開始前')
    const saveBtn = screen.getByRole('button', { name: '保存' })
    expect(saveBtn).toBeDisabled()

    fireEvent.change(labelInput, { target: { value: '中間チェックポイント' } })
    expect(saveBtn).not.toBeDisabled()

    fireEvent.click(saveBtn)
    expect(onSave).toHaveBeenCalledWith('中間チェックポイント')
  })

  it('allows selecting a checkpoint to restore with confirmation reason', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onRestore = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const checkpoints = [makeManifest('cp-1', '第1ラウンド')]

    render(
      <HouseholdCheckpointModal
        isOpen={true}
        onClose={onClose}
        checkpoints={checkpoints}
        onSaveManualCheckpoint={onSave}
        onRestoreCheckpoint={onRestore}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('第1ラウンド')).toBeInTheDocument()
    const restoreTriggerBtn = screen.getByRole('button', { name: '復元...' })
    fireEvent.click(restoreTriggerBtn)

    expect(screen.getByText('チェックポイント復元の確認')).toBeInTheDocument()
    const reasonInput = screen.getByPlaceholderText('例: 誤った決算のやり直し')
    const confirmRestoreBtn = screen.getByRole('button', { name: 'このチェックポイントに復元' })
    expect(confirmRestoreBtn).toBeDisabled()

    fireEvent.change(reasonInput, { target: { value: '誤操作のため' } })
    expect(confirmRestoreBtn).not.toBeDisabled()

    fireEvent.click(confirmRestoreBtn)
    expect(onRestore).toHaveBeenCalledWith('cp-1', '誤操作のため')
  })
})
