import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HouseholdTeacherDashboard } from './HouseholdTeacherDashboard'
import type { HouseholdTeacherDashboard as HouseholdTeacherDashboardType } from '../../lib/homeEconomics/teacherDashboard'

const makeDashboard = (overrides: Partial<HouseholdTeacherDashboardType> = {}): HouseholdTeacherDashboardType => ({
  lessonRunId: 'run-1',
  subject: 'HOME_ECONOMICS',
  courseFormat: 'COMMON_CONDITIONS',
  restoreGeneration: 0,
  currentRoundIndex: 1,
  householdsAligned: true,
  updatedAtServerMillis: 1000,
  households: [
    {
      householdId: 'team-a',
      teamId: 'team-a',
      teamDisplayName: 'チーム A',
      lifeStage: 'INDEPENDENT',
      roundIndex: 1,
      submittedForRoundIndex: true,
      submittedAtServerMillis: 1000,
      lastSettledRoundIndex: 0,
      cashYen: 1500000,
      assetHoldingsYen: { DOMESTIC_STOCK: 200000 },
      totalAssetsYen: 200000,
      activeInsuranceContracts: { 'ins-1': 3 },
      activeLiabilities: {},
      lastSettlementSummary: {
        roundIndex: 0,
        incomeYen: 3000000,
        expensesYen: 2000000,
        netCashFlowYen: 1000000,
        shortfallYen: 0,
        insuranceBenefitsYen: 0,
      },
      goalDelayedRounds: 0,
      revealedEvents: [{ eventId: 'ev-1', label: '就職', effectDescription: '昇給' }],
      warnings: [],
    },
    {
      householdId: 'team-b',
      teamId: 'team-b',
      teamDisplayName: 'チーム B',
      lifeStage: 'INDEPENDENT',
      roundIndex: 1,
      submittedForRoundIndex: false,
      submittedAtServerMillis: null,
      lastSettledRoundIndex: 0,
      cashYen: 500000,
      assetHoldingsYen: {},
      totalAssetsYen: 0,
      activeInsuranceContracts: {},
      activeLiabilities: {},
      lastSettlementSummary: null,
      goalDelayedRounds: 1,
      revealedEvents: [],
      warnings: [
        { severity: 'ACTION_REQUIRED', code: 'UNSUBMITTED_DECISION', message: '現在のラウンドの意思決定が未提出です' },
        { severity: 'WARNING', code: 'GOAL_DELAYED', message: '目標達成が1回延期されています' },
      ],
    },
  ],
  checkpoints: [],
  activeBulkOperation: null,
  ...overrides,
})

describe('HouseholdTeacherDashboard', () => {
  it('renders dashboard with summary stats and household rows', () => {
    const dashboard = makeDashboard()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const onProcessBatch = vi.fn().mockResolvedValue(undefined)
    const onRetryBatch = vi.fn().mockResolvedValue(undefined)
    const onProcessIndividual = vi.fn().mockResolvedValue(undefined)
    const onSaveCheckpoint = vi.fn().mockResolvedValue(undefined)
    const onRestoreCheckpoint = vi.fn().mockResolvedValue(undefined)

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        onRefresh={onRefresh}
        onProcessRoundBatch={onProcessBatch}
        onRetryRoundBatch={onRetryBatch}
        onProcessIndividualRound={onProcessIndividual}
        onSaveManualCheckpoint={onSaveCheckpoint}
        onRestoreCheckpoint={onRestoreCheckpoint}
      />,
    )

    expect(screen.getByText('家庭経済・ライフプラン管理ダッシュボード')).toBeInTheDocument()
    expect(screen.getByText('第2ラウンド')).toBeInTheDocument()
    expect(screen.getByText('チーム A')).toBeInTheDocument()
    expect(screen.getByText('チーム B')).toBeInTheDocument()
    expect(screen.getByText('現在のラウンドの意思決定が未提出です')).toBeInTheDocument()
    expect(screen.getByText('目標達成が1回延期されています')).toBeInTheDocument()
  })

  it('opens bulk settlement modal when clicking 一括決算', () => {
    const dashboard = makeDashboard()
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        onRefresh={vi.fn()}
        onProcessRoundBatch={vi.fn()}
        onRetryRoundBatch={vi.fn()}
        onProcessIndividualRound={vi.fn()}
        onSaveManualCheckpoint={vi.fn()}
        onRestoreCheckpoint={vi.fn()}
      />,
    )

    const bulkBtn = screen.getByRole('button', { name: '一括決算' })
    fireEvent.click(bulkBtn)

    expect(screen.getByText('第2ラウンド 一括決算の確認')).toBeInTheDocument()
  })

  it('shows retry banner and allows retry when active bulk operation is FAILED', () => {
    const dashboard = makeDashboard({
      activeBulkOperation: {
        operationId: 'op-1',
        lessonRunId: 'run-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 1,
        restoreGeneration: 0,
        forceUnsubmitted: false,
        status: 'FAILED',
        preSettlementCheckpointId: 'cp-1',
        attempt: 1,
        leaseActive: false,
        retryable: true,
        households: {
          'team-b': { status: 'FAILED', errorMessage: 'Simulation error' },
        },
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 2000,
      },
    })
    const onRetryBatch = vi.fn().mockResolvedValue(undefined)

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        onRefresh={vi.fn()}
        onProcessRoundBatch={vi.fn()}
        onRetryRoundBatch={onRetryBatch}
        onProcessIndividualRound={vi.fn()}
        onSaveManualCheckpoint={vi.fn()}
        onRestoreCheckpoint={vi.fn()}
      />,
    )

    expect(screen.getByText(/前回の第2ラウンド一括決算でエラーが発生しました/)).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '一括決算を再試行' })
    fireEvent.click(retryBtn)

    expect(onRetryBatch).toHaveBeenCalledWith('op-1')
  })
})
