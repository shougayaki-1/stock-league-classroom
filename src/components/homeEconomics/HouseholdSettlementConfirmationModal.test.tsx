import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  HouseholdSettlementConfirmationModal,
} from './HouseholdSettlementConfirmationModal'
import type { HouseholdTeacherRow, HouseholdTeacherTeamRow } from '../../lib/homeEconomics/teacherDashboard'

const makeRow = (id: string, teamId: string, teamDisplayName: string, lifeStage: string, submitted: boolean): HouseholdTeacherRow => ({
  householdId: id,
  teamId,
  teamDisplayName,
  lifeStage,
  profileSummary: { lifeStage, family: '' },
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

const makeSingleHouseholdTeam = (teamId: string, teamDisplayName: string, submitted: boolean): HouseholdTeacherTeamRow => {
  const household = makeRow(teamId, teamId, teamDisplayName, 'INDEPENDENT', submitted)
  return {
    teamId,
    teamDisplayName,
    submittedCount: submitted ? 1 : 0,
    totalHouseholds: 1,
    allSubmitted: submitted,
    warnings: [],
    households: [household],
  }
}

describe('HouseholdSettlementConfirmationModal', () => {
  it('renders class target counts (households and teams) and allows confirmation when all submitted', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const teams = [makeSingleHouseholdTeam('team-a', 'チーム a', true), makeSingleHouseholdTeam('team-b', 'チーム b', true)]

    render(
      <HouseholdSettlementConfirmationModal
        isOpen={true}
        onClose={onClose}
        currentRoundIndex={1}
        teams={teams}
        onConfirm={onConfirm}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('第2ラウンド 一括決算の確認')).toBeInTheDocument()
    expect(screen.getByText('全 2 世帯（2 チーム）の意思決定が提出されています。')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '決算を実行' })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('shows unsubmitted warning with exact team labels and requires force checkbox (single-household teams)', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const teams = [makeSingleHouseholdTeam('team-a', 'チーム a', true), makeSingleHouseholdTeam('team-b', 'チーム b', false)]

    render(
      <HouseholdSettlementConfirmationModal
        isOpen={true}
        onClose={onClose}
        currentRoundIndex={1}
        teams={teams}
        onConfirm={onConfirm}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('未提出の家庭があります（1 / 2 世帯提出済み、対象 2 チーム）')).toBeInTheDocument()
    expect(screen.getByText('チーム b')).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: '強制決算を実行' })
    expect(confirmBtn).toBeDisabled()

    const forceCheckbox = screen.getByRole('checkbox', { name: /未提出の家庭を含めて強制決算を行う/ })
    fireEvent.click(forceCheckbox)
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('reports exact missing team/profile labels for a MULTI_PERSON_PER_TEAM team with partial submission', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const teams: HouseholdTeacherTeamRow[] = [
      {
        teamId: 'team-multi',
        teamDisplayName: 'チーム X',
        submittedCount: 1,
        totalHouseholds: 2,
        allSubmitted: false,
        warnings: [],
        households: [
          makeRow('team-multi-h1', 'team-multi', 'チーム X', '独身', true),
          makeRow('team-multi-h2', 'team-multi', 'チーム X', '子育て', false),
        ],
      },
    ]

    render(
      <HouseholdSettlementConfirmationModal
        isOpen={true}
        onClose={onClose}
        currentRoundIndex={1}
        teams={teams}
        onConfirm={onConfirm}
        isSubmitting={false}
      />,
    )

    expect(screen.getByText('未提出の家庭があります（1 / 2 世帯提出済み、対象 1 チーム）')).toBeInTheDocument()
    expect(screen.getByText('チーム X — 子育て')).toBeInTheDocument()
    expect(screen.queryByText('チーム X — 独身')).not.toBeInTheDocument()
  })
})
