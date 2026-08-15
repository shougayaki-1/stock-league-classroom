import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  HouseholdSettlementConfirmationModal,
} from './HouseholdSettlementConfirmationModal'
import type { HouseholdTeacherRow } from '../../lib/homeEconomics/teacherDashboard'

const makeRow = (id: string, submitted: boolean): HouseholdTeacherRow => ({
  householdId: id,
  teamId: id,
  teamDisplayName: `チーム ${id}`,
  lifeStage: 'INDEPENDENT',
  roundIndex: 1,
  submittedForRoundIndex: submitted,
  submittedAtServerMillis: submitted ? 1000 : null,
  lastSettledRoundIndex: 0,
  cashYen: 1000000,
  assetHoldingsYen: {},
  totalAssetsYen: 0,
  activeInsuranceContracts: {},
  activeLiabilities: {},
  lastSettlementSummary: null,
  goalDelayedRounds: 0,
  revealedEvents: [],
  warnings: [],
})

describe('HouseholdSettlementConfirmationModal', () => {
  it('renders modal when open and allows confirmation when all submitted', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const households = [makeRow('a', true), makeRow('b', true)]

    render(
      <HouseholdSettlementConfirmationModal
        isOpen={true}
        onClose={onClose}
        currentRoundIndex={1}
        households={households}
        onConfirm={onConfirm}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('第2ラウンド 一括決算の確認')).toBeInTheDocument()
    expect(screen.getByText('全 2 チームの意思決定が提出されています。')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '決算を実行' })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('shows unsubmitted warning and requires force checkbox when some teams unsubmitted', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const households = [makeRow('a', true), makeRow('b', false)]

    render(
      <HouseholdSettlementConfirmationModal
        isOpen={true}
        onClose={onClose}
        currentRoundIndex={1}
        households={households}
        onConfirm={onConfirm}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('未提出のチームがあります（1 / 2 チーム提出済み）')).toBeInTheDocument()
    expect(screen.getByText('チーム b')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '強制決算を実行' })
    expect(confirmBtn).toBeDisabled()

    const forceCheckbox = screen.getByRole('checkbox', { name: /未提出チームを含めて強制決算を行う/ })
    fireEvent.click(forceCheckbox)
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })
})
