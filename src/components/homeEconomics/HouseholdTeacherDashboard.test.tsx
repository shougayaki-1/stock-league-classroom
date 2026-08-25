import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HouseholdTeacherDashboard } from './HouseholdTeacherDashboard'
import type {
  HouseholdTeacherDashboard as HouseholdTeacherDashboardType,
  HouseholdTeacherRow,
  HouseholdTeacherTeamRow,
} from '../../lib/homeEconomics/teacherDashboard'
import type { HouseholdAssignmentView } from '../../lib/homeEconomics/householdAssignment'

const makeHousehold = (overrides: Partial<HouseholdTeacherRow> = {}): HouseholdTeacherRow => ({
  householdId: 'team-a',
  teamId: 'team-a',
  teamDisplayName: 'チーム A',
  lifeStage: 'INDEPENDENT',
  profileSummary: { lifeStage: 'INDEPENDENT', family: '単身' },
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
  ...overrides,
})

const teamA = makeHousehold()
const teamB = makeHousehold({
  householdId: 'team-b',
  teamId: 'team-b',
  teamDisplayName: 'チーム B',
  submittedForRoundIndex: false,
  submittedAtServerMillis: null,
  cashYen: 500000,
  assetHoldingsYen: {},
  totalAssetsYen: 0,
  activeInsuranceContracts: {},
  lastSettlementSummary: null,
  goalDelayedRounds: 1,
  revealedEvents: [],
  warnings: [
    { severity: 'ACTION_REQUIRED', code: 'UNSUBMITTED_DECISION', message: '現在のラウンドの意思決定が未提出です' },
    { severity: 'WARNING', code: 'GOAL_DELAYED', message: '目標達成が1回延期されています' },
  ],
})

const singleHouseholdTeam = (household: HouseholdTeacherRow): HouseholdTeacherTeamRow => ({
  teamId: household.teamId,
  teamDisplayName: household.teamDisplayName,
  submittedCount: household.submittedForRoundIndex ? 1 : 0,
  totalHouseholds: 1,
  allSubmitted: household.submittedForRoundIndex,
  warnings: [],
  households: [household],
})

const makeDashboard = (overrides: Partial<HouseholdTeacherDashboardType> = {}): HouseholdTeacherDashboardType => ({
  lessonRunId: 'run-1',
  subject: 'HOME_ECONOMICS',
  courseFormat: 'COMMON_CONDITIONS',
  assignment: null,
  restoreGeneration: 0,
  synchronizedRoundIndex: 1,
  roundStatus: null,
  currentRoundIndex: 1,
  householdsAligned: true,
  updatedAtServerMillis: 1000,
  teams: [singleHouseholdTeam(teamA), singleHouseholdTeam(teamB)],
  checkpoints: [],
  activeBulkOperation: null,
  finalComparisonAvailable: false,
  ...overrides,
})

const noopHandlers = {
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onProcessRoundBatch: vi.fn().mockResolvedValue(undefined),
  onRetryRoundBatch: vi.fn().mockResolvedValue(undefined),
  onProcessIndividualRound: vi.fn().mockResolvedValue(undefined),
  onSaveManualCheckpoint: vi.fn().mockResolvedValue(undefined),
  onRestoreCheckpoint: vi.fn().mockResolvedValue(undefined),
}

describe('HouseholdTeacherDashboard (Common — single-household-per-team)', () => {
  it('renders dashboard with summary stats and team rows', () => {
    const dashboard = makeDashboard()

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.getByText('家庭経済・ライフプラン管理ダッシュボード')).toBeInTheDocument()
    expect(screen.getByText('第2ラウンド')).toBeInTheDocument()
    expect(screen.getByText('チーム A')).toBeInTheDocument()
    expect(screen.getByText('チーム B')).toBeInTheDocument()
    expect(screen.getByText('現在のラウンドの意思決定が未提出です')).toBeInTheDocument()
    expect(screen.getByText('目標達成が1回延期されています')).toBeInTheDocument()
  })

  it('never exposes the internal restoreGeneration counter as UI copy — shows fixed 復元済み copy instead', () => {
    const dashboard = makeDashboard({ restoreGeneration: 4 })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.getByText('復元済み')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/第\s*4\s*世代/)
    expect(document.body.textContent).not.toContain('世代')
  })

  it('opens bulk settlement modal when clicking 一括決算', () => {
    const dashboard = makeDashboard()
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    const bulkBtn = screen.getByRole('button', { name: '一括決算' })
    fireEvent.click(bulkBtn)

    expect(screen.getByText('第2ラウンド 一括決算の確認')).toBeInTheDocument()
  })

  it('disables 個別決算 for an unsubmitted household and never sends forceSettle=true from the individual path', () => {
    const dashboard = makeDashboard()
    const onProcessIndividual = vi.fn().mockResolvedValue(undefined)

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onProcessIndividualRound={onProcessIndividual}
      />,
    )

    const individualButtons = screen.getAllByRole('button', { name: '個別決算' })
    expect(individualButtons[0]).not.toBeDisabled()
    expect(individualButtons[1]).toBeDisabled()

    fireEvent.click(individualButtons[1])
    expect(screen.queryByText('チーム B の個別決算')).not.toBeInTheDocument()
    expect(onProcessIndividual).not.toHaveBeenCalled()

    fireEvent.click(individualButtons[0])
    const confirmBtn = screen.getByRole('button', { name: '個別決算を実行' })
    fireEvent.click(confirmBtn)
    expect(onProcessIndividual).toHaveBeenCalledWith('team-a', false)
  })

  it('disables 個別決算・チェックポイント・復元 while a bulk operation lease is active', () => {
    const dashboard = makeDashboard({
      activeBulkOperation: {
        operationId: 'op-1',
        lessonRunId: 'run-1',
        actorUid: 'teacher-1',
        expectedRoundIndex: 1,
        restoreGeneration: 0,
        forceUnsubmitted: false,
        status: 'RUNNING',
        preSettlementCheckpointId: 'cp-1',
        attempt: 1,
        leaseActive: true,
        retryable: false,
        households: {},
        createdAtServerMillis: 1000,
        updatedAtServerMillis: 2000,
      },
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.getByRole('button', { name: 'チェックポイント・復元' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '一括決算' })).toBeDisabled()
    for (const btn of screen.getAllByRole('button', { name: '個別決算' })) {
      expect(btn).toBeDisabled()
    }
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
        {...noopHandlers}
        onRetryRoundBatch={onRetryBatch}
      />,
    )

    expect(screen.getByText(/前回の第2ラウンド一括決算でエラーが発生しました/)).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: '一括決算を再試行' })
    fireEvent.click(retryBtn)

    expect(onRetryBatch).toHaveBeenCalledWith('op-1')
  })
})

describe('HouseholdTeacherDashboard (advanced formats — team-primary)', () => {
  const multiHouseholdA = makeHousehold({
    householdId: 'team-multi-h1', teamId: 'team-multi', teamDisplayName: 'チーム X', lifeStage: 'INDEPENDENT',
    profileSummary: { lifeStage: 'INDEPENDENT', family: '一人暮らし' }, submittedForRoundIndex: true,
  })
  const multiHouseholdB = makeHousehold({
    householdId: 'team-multi-h2', teamId: 'team-multi', teamDisplayName: 'チーム X', lifeStage: 'CHILD_REARING',
    profileSummary: { lifeStage: 'CHILD_REARING', family: '配偶者と子2人' }, submittedForRoundIndex: false, submittedAtServerMillis: null,
    warnings: [{ severity: 'ACTION_REQUIRED', code: 'UNSUBMITTED_DECISION', message: '子育て世帯の意思決定が未提出です' }],
  })
  const multiTeam: HouseholdTeacherTeamRow = {
    teamId: 'team-multi',
    teamDisplayName: 'チーム X',
    submittedCount: 1,
    totalHouseholds: 2,
    allSubmitted: false,
    warnings: [],
    households: [multiHouseholdA, multiHouseholdB],
  }

  const readyAssignment: HouseholdAssignmentView = {
    lessonRunId: 'run-1',
    courseFormat: 'MULTI_PERSON_PER_TEAM',
    state: 'FROZEN',
    validationStatus: 'READY',
    assignmentRevision: 1,
    warnings: [],
    teams: [
      { teamId: 'team-multi', teamDisplayName: 'チーム X', entries: [
        { householdId: 'team-multi-h1', profileId: 'p1', profileSummary: { lifeStage: 'INDEPENDENT', family: '一人暮らし' }, displayOrder: 0, assignmentSource: 'AUTO' },
        { householdId: 'team-multi-h2', profileId: 'p2', profileSummary: { lifeStage: 'CHILD_REARING', family: '配偶者と子2人' }, displayOrder: 1, assignmentSource: 'AUTO' },
      ] },
    ],
  }

  it('shows genuine x/y progress and per-household errors for a MULTI_PERSON_PER_TEAM team', () => {
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      teams: [multiTeam],
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )

    expect(screen.getAllByText('1 / 2 提出済み').length).toBeGreaterThan(0)
    expect(screen.getByText('子育て世帯の意思決定が未提出です')).toBeInTheDocument()
  })

  /**
   * Important I3 (whole-branch review): a MULTI team's several household
   * rows were previously distinguishable only by `lifeStage` (which
   * MULTI_PERSON_PER_TEAM can repeat across its full profile set) or the
   * opaque runtime householdId. This proves the translated lifeStage・
   * family label (built client-side via `formatHouseholdProfileLabel`) is
   * what actually renders per row.
   */
  it('renders each household row by its human-readable translated profile label, not the opaque runtime householdId', () => {
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      teams: [multiTeam],
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )

    expect(screen.getAllByText('独立期・一人暮らし').length).toBeGreaterThan(0)
    expect(screen.getAllByText('子育て期・配偶者と子2人').length).toBeGreaterThan(0)
    expect(screen.queryByText('team-multi-h1')).not.toBeInTheDocument()
    expect(screen.queryByText('team-multi-h2')).not.toBeInTheDocument()
  })

  it('falls back to fixed Japanese copy — never the raw householdId — when a household row has no profileSummary', () => {
    const missingProfileHousehold = makeHousehold({
      householdId: 'runtime-secret-household', teamId: 'team-multi', teamDisplayName: 'チーム X',
      profileSummary: undefined,
    })
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      teams: [{ ...multiTeam, households: [missingProfileHousehold] }],
    })
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )
    expect(screen.getByText('家庭プロフィールを確認できません')).toBeInTheDocument()
    expect(screen.queryByText('runtime-secret-household')).not.toBeInTheDocument()
  })

  it('never renders individual settlement for advanced formats (regression)', () => {
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      teams: [multiTeam],
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '個別決算' })).not.toBeInTheDocument()
  })

  it('still renders individual settlement for COMMON_CONDITIONS (regression)', () => {
    const dashboard = makeDashboard()

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.getAllByRole('button', { name: '個別決算' }).length).toBeGreaterThan(0)
  })

  it('disables チェックポイント・復元 and 一括決算 for advanced formats while roundStatus is SETTLING', () => {
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      roundStatus: 'SETTLING',
      teams: [multiTeam],
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'チェックポイント・復元' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '一括決算' })).toBeDisabled()
  })

  it('does not disable checkpoint/bulk controls for Common when roundStatus is null even though SETTLING would apply to advanced only', () => {
    const dashboard = makeDashboard({ roundStatus: null })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.getByRole('button', { name: 'チェックポイント・復元' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '一括決算' })).not.toBeDisabled()
  })

  it('renders the HouseholdAssignmentPanel for advanced formats when assignment and handlers are provided', () => {
    const dashboard = makeDashboard({
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      assignment: readyAssignment,
      teams: [multiTeam],
    })

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
        onPrepareAssignment={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    )

    expect(screen.getByText('家庭の割り当て')).toBeInTheDocument()
  })

  it('does not render the assignment panel for COMMON_CONDITIONS', () => {
    const dashboard = makeDashboard()

    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        {...noopHandlers}
      />,
    )

    expect(screen.queryByText('家庭の割り当て')).not.toBeInTheDocument()
  })
})

describe('HouseholdTeacherDashboard — class comparison teacher actions (Task 13)', () => {
  it('hides both actions when finalComparisonAvailable is false, even with display authority and handlers present', () => {
    const dashboard = makeDashboard({ finalComparisonAvailable: false })
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={true}
        canManageDisplay={true}
        onViewClassComparison={vi.fn()}
        onShowOnDisplay={vi.fn()}
        {...noopHandlers}
      />,
    )
    expect(screen.queryByRole('button', { name: 'クラス比較を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '教室画面に表示' })).not.toBeInTheDocument()
  })

  it('hides both actions when finalComparisonAvailable is true but the teacher lacks display authority (canManageDisplay false — VIEWER)', () => {
    const dashboard = makeDashboard({ finalComparisonAvailable: true })
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={false}
        canManageDisplay={false}
        onViewClassComparison={vi.fn()}
        onShowOnDisplay={vi.fn()}
        {...noopHandlers}
      />,
    )
    expect(screen.queryByRole('button', { name: 'クラス比較を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '教室画面に表示' })).not.toBeInTheDocument()
  })

  it('shows both actions for an ASSISTANT (canManageDisplay true, isPrimaryTeacher false) once a final comparison exists, and invokes the given callbacks', () => {
    const dashboard = makeDashboard({ finalComparisonAvailable: true })
    const onViewClassComparison = vi.fn()
    const onShowOnDisplay = vi.fn()
    render(
      <HouseholdTeacherDashboard
        dashboard={dashboard}
        isPrimaryTeacher={false}
        canManageDisplay={true}
        onViewClassComparison={onViewClassComparison}
        onShowOnDisplay={onShowOnDisplay}
        {...noopHandlers}
      />,
    )

    const viewBtn = screen.getByRole('button', { name: 'クラス比較を見る' })
    const displayBtn = screen.getByRole('button', { name: '教室画面に表示' })
    fireEvent.click(viewBtn)
    fireEvent.click(displayBtn)

    expect(onViewClassComparison).toHaveBeenCalledTimes(1)
    expect(onShowOnDisplay).toHaveBeenCalledTimes(1)
  })
})
