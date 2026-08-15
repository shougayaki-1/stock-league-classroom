import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Functions } from 'firebase/functions'
import { HouseholdTeacherDashboard } from './HouseholdTeacherDashboard'
import * as teacherDashboardLib from '../../lib/homeEconomics/teacherDashboard'
import * as bulkSettlementLib from '../../lib/homeEconomics/bulkSettlement'

vi.mock('../../lib/homeEconomics/teacherDashboard', () => ({
  getHouseholdTeacherDashboard: vi.fn(),
}))

vi.mock('../../lib/homeEconomics/bulkSettlement', () => ({
  processHouseholdRoundBatch: vi.fn(),
  retryHouseholdRoundBatch: vi.fn(),
}))

vi.mock('../../lib/homeEconomics/processRound', () => ({
  processRound: vi.fn(),
}))

vi.mock('../../lib/homeEconomics/checkpoints', () => ({
  writeHouseholdCheckpoint: vi.fn(),
  restoreHouseholdCheckpoint: vi.fn(),
}))

describe('HouseholdTeacherDashboard (Container)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockDashboardData: teacherDashboardLib.HouseholdTeacherDashboard = {
    lessonRunId: 'run-1',
    subject: 'HOME_ECONOMICS',
    courseFormat: 'COMMON_CONDITIONS',
    restoreGeneration: 0,
    currentRoundIndex: 0,
    householdsAligned: true,
    updatedAtServerMillis: 1000,
    households: [
      {
        householdId: 'team-1',
        teamId: 'team-1',
        teamDisplayName: 'チーム1',
        lifeStage: 'INDEPENDENT',
        roundIndex: 0,
        submittedForRoundIndex: true,
        submittedAtServerMillis: 500,
        lastSettledRoundIndex: null,
        cashYen: 1000000,
        assetHoldingsYen: {},
        totalAssetsYen: 0,
        activeInsuranceContracts: {},
        activeLiabilities: {},
        lastSettlementSummary: null,
        goalDelayedRounds: 0,
        revealedEvents: [],
        warnings: [],
      },
    ],
    checkpoints: [],
    activeBulkOperation: null,
  }

  it('fetches dashboard on mount and renders content', async () => {
    vi.mocked(teacherDashboardLib.getHouseholdTeacherDashboard).mockResolvedValue(mockDashboardData)
    const functions = {} as Functions

    render(<HouseholdTeacherDashboard lessonRunId="run-1" role="PRIMARY" functions={functions} />)

    expect(screen.getByText('家庭科ダッシュボードを読み込み中...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('家庭経済・ライフプラン管理ダッシュボード')).toBeInTheDocument()
    })

    expect(screen.getByText('チーム1')).toBeInTheDocument()
    expect(teacherDashboardLib.getHouseholdTeacherDashboard).toHaveBeenCalledWith(functions, { lessonRunId: 'run-1' })
  })

  it('handles bulk settlement invocation and reloads dashboard', async () => {
    vi.mocked(teacherDashboardLib.getHouseholdTeacherDashboard).mockResolvedValue(mockDashboardData)
    vi.mocked(bulkSettlementLib.processHouseholdRoundBatch).mockResolvedValue({
      operationId: 'op-1',
      lessonRunId: 'run-1',
      actorUid: 'teacher-1',
      expectedRoundIndex: 0,
      restoreGeneration: 0,
      forceUnsubmitted: false,
      status: 'COMPLETED',
      preSettlementCheckpointId: 'cp-1',
      attempt: 1,
      leaseActive: false,
      retryable: false,
      households: {},
      createdAtServerMillis: 1000,
      updatedAtServerMillis: 1000,
    })
    const functions = {} as Functions

    render(<HouseholdTeacherDashboard lessonRunId="run-1" role="PRIMARY" functions={functions} />)

    await waitFor(() => {
      expect(screen.getByText('家庭経済・ライフプラン管理ダッシュボード')).toBeInTheDocument()
    })

    const bulkBtn = screen.getByRole('button', { name: '一括決算' })
    fireEvent.click(bulkBtn)

    const confirmBtn = screen.getByRole('button', { name: '決算を実行' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(bulkSettlementLib.processHouseholdRoundBatch).toHaveBeenCalledWith(
        functions,
        expect.objectContaining({
          lessonRunId: 'run-1',
          expectedRoundIndex: 0,
          forceUnsubmitted: false,
        }),
      )
    })
  })

  it('renders error state when load fails', async () => {
    vi.mocked(teacherDashboardLib.getHouseholdTeacherDashboard).mockRejectedValue(new Error('Network error'))
    const functions = {} as Functions

    render(<HouseholdTeacherDashboard lessonRunId="run-1" role="PRIMARY" functions={functions} />)

    await waitFor(() => {
      expect(screen.getByText('ダッシュボードの読み込みエラー')).toBeInTheDocument()
    })
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })
})
