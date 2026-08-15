import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import type { HouseholdBulkSettlementOperationView } from './bulkSettlementOperation'
import type { HouseholdState } from '../lessonRuns/households/repository'
import {
  buildHouseholdTeacherDashboard,
  buildHouseholdTeacherRow,
  computeRoundMisalignmentWarning,
  normalizeTeamDisplayName,
  type BuildHouseholdTeacherDashboardInput,
} from './teacherDashboard'

const makeValidCommonConditionsContent = (): HomeEconomicsContent => ({
  courseFormat: 'COMMON_CONDITIONS',
  households: [
    {
      householdId: 'profile-1',
      age: 30,
      family: '単身',
      housing: '賃貸',
      lifeGoal: '貯蓄',
      lifeStage: 'INDEPENDENT',
      cashSavingsYen: 1500000,
      householdIncomeYen: 3000000,
      annualLivingExpensesYen: 2000000,
      eventProbabilityOverrides: {},
      internalRiskFactors: {
        healthRiskSeverity: 10, // private data
      },
    },
  ],
  assets: [{ assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 5, volatilityPercent: 10 }],
  insuranceProducts: [{
    id: 'ins-1',
    productName: '医療保険',
    coveredRisk: 'HEALTH',
    benefitDescription: 'desc',
    premiumYenPerYear: 50000,
    benefitAmountYen: 1000000,
    contractYears: 5,
    coveredEventIds: ['event-1'],
    internalClaimProbability: 0.05, // private data
  }],
  lifeEvents: [
    {
      id: 'event-1',
      label: '入院イベント',
      disclosureMode: 'ANNOUNCED',
      triggerProbability: 0.1,
      effectDescription: '医療費が発生',
      incomeEffectYen: 0,
      expenseEffectYen: 200000,
      cashEffectYen: 0,
    },
  ],
  liabilities: [],
  publicSupportPrograms: [],
  roundYears: 5,
  economicFactors: { inflationPercent: 1, interestRatePercent: 0.1, marketReturnPercent: 2 },
  borrowingAllowed: false,
  taxAndSocialInsuranceModelVersion: 1,
  goalPackage: 'OVERALL_BALANCE',
  evaluationWeights: {
    lifeGoalAchievement: 1, emergencyFundAdequacy: 0, stability: 0, diversification: 0, borrowingBurden: 0, reflection: 0,
  },
})

const makeState = (overrides: Partial<HouseholdState> & { householdId: string; teamId: string }): HouseholdState => ({
  lessonRunId: 'run-1',
  profileId: overrides.householdId,
  cashYen: 100,
  assetHoldingsYen: {},
  activeInsuranceContracts: {},
  activeLiabilities: {},
  lifeStage: 'INDEPENDENT',
  roundIndex: 0,
  goalDelayedRounds: 0,
  updatedAtServerMillis: 0,
  ...overrides,
})

describe('normalizeTeamDisplayName', () => {
  it('returns trimmed displayName when valid non-empty string', () => {
    expect(normalizeTeamDisplayName('team-1', { displayName: ' チームA ' })).toBe('チームA')
  })

  it('falls back to teamId when displayName is missing, empty or non-string', () => {
    expect(normalizeTeamDisplayName('team-1', {})).toBe('team-1')
    expect(normalizeTeamDisplayName('team-1', { displayName: '   ' })).toBe('team-1')
    expect(normalizeTeamDisplayName('team-1', { displayName: 123 })).toBe('team-1')
  })
})

describe('buildHouseholdTeacherRow', () => {
  const content = makeValidCommonConditionsContent()

  const state: HouseholdState = {
    householdId: 'team-1',
    lessonRunId: 'run-1',
    teamId: 'team-1',
    profileId: 'team-1',
    cashYen: 500000,
    assetHoldingsYen: { DOMESTIC_STOCK: 200000 },
    activeInsuranceContracts: { 'ins-1': 3 },
    activeLiabilities: { 'loan-1': { remainingPrincipalYen: 1000000, remainingYears: 5, annualInterestRatePercent: 1.5 } },
    lifeStage: 'INDEPENDENT',
    roundIndex: 1,
    goalDelayedRounds: 1,
    updatedAtServerMillis: 1000,
  }

  it('projects safe row data, computing totalAssetsYen and warnings', () => {
    const row = buildHouseholdTeacherRow({
      teamId: 'team-1',
      teamDisplayName: 'チーム1',
      state,
      content,
      decision: {
        decisionId: 'dec-1',
        lessonRunId: 'run-1',
        householdId: 'team-1',
        roundIndex: 1,
        assetAllocationChangesYen: {},
        insurancePurchaseIds: [],
        insuranceCancelIds: [],
        shortfallResolutionType: null,
        publicSupportApplicationIds: [],
        idempotencyKey: 'k-1',
        submittedAtServerMillis: 1500,
      },
      lastSettlementEventPayload: {
        householdId: 'team-1',
        roundIndex: 0,
        occurredEventIds: ['event-1'],
        incomeYen: 3000000,
        expensesYen: 2000000,
        netCashFlowYen: 1000000,
        shortfallYen: 50000,
        insuranceBenefitsYen: 0,
      },
      bulkItemStatus: null,
      restoreGeneration: 0,
    })

    expect(row.householdId).toBe('team-1')
    expect(row.teamDisplayName).toBe('チーム1')
    expect(row.totalAssetsYen).toBe(200000)
    expect(row.submittedForRoundIndex).toBe(true)
    expect(row.submittedAtServerMillis).toBe(1500)
    expect(row.lastSettledRoundIndex).toBe(0)
    expect(row.lastSettlementSummary).toEqual({
      roundIndex: 0,
      incomeYen: 3000000,
      expensesYen: 2000000,
      netCashFlowYen: 1000000,
      shortfallYen: 50000,
      insuranceBenefitsYen: 0,
    })

    // Warnings
    const warningCodes = row.warnings.map((w) => w.code)
    expect(warningCodes).toContain('SHORTFALL_OCCURRED')
    expect(warningCodes).toContain('GOAL_DELAYED')
    // ROUND_MISALIGNED is no longer a per-household warning (Task 10 moved
    // it to team level, since it's a global/team-scoped condition — see
    // `computeRoundMisalignmentWarning`).
    expect(warningCodes).not.toContain('ROUND_MISALIGNED')

    // Revealed events
    expect(row.revealedEvents).toEqual([
      { eventId: 'event-1', label: '入院イベント', effectDescription: '医療費が発生' },
    ])

    // Private fields should not be present
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('healthRiskSeverity')
    expect(serialized).not.toContain('internalClaimProbability')
    expect(serialized).not.toContain('annualInterestRatePercent')
  })

  it('reports BULK_SETTLEMENT_FAILED, keyed by the row itself (bulkItemStatus is resolved by RUNTIME householdId by the caller)', () => {
    const row = buildHouseholdTeacherRow({
      teamId: 'team-1',
      teamDisplayName: 'チーム1',
      state,
      content,
      decision: null,
      lastSettlementEventPayload: null,
      bulkItemStatus: { status: 'FAILED', errorMessage: '決算に失敗しました' },
      restoreGeneration: 0,
    })
    const warningCodes = row.warnings.map((w) => w.code)
    expect(warningCodes).toContain('BULK_SETTLEMENT_FAILED')
    expect(row.warnings.find((w) => w.code === 'BULK_SETTLEMENT_FAILED')?.message).toBe('決算に失敗しました')
  })
})

describe('computeRoundMisalignmentWarning', () => {
  it('returns null when aligned, regardless of roundStatus', () => {
    expect(computeRoundMisalignmentWarning(true, null)).toBeNull()
    expect(computeRoundMisalignmentWarning(true, 'OPEN')).toBeNull()
    expect(computeRoundMisalignmentWarning(true, 'SETTLING')).toBeNull()
  })

  it('is INFO (recoverable) when misaligned during an active SETTLING bulk operation', () => {
    const warning = computeRoundMisalignmentWarning(false, 'SETTLING')
    expect(warning?.severity).toBe('INFO')
    expect(warning?.code).toBe('ROUND_MISALIGNED')
  })

  it('is ACTION_REQUIRED when misaligned while roundStatus is OPEN (no bulk settlement is running)', () => {
    const warning = computeRoundMisalignmentWarning(false, 'OPEN')
    expect(warning?.severity).toBe('ACTION_REQUIRED')
    expect(warning?.code).toBe('ROUND_MISALIGNED')
  })

  it('is INFO when misaligned and roundStatus is null (COMMON_CONDITIONS, no control document) — preserves legacy behavior', () => {
    const warning = computeRoundMisalignmentWarning(false, null)
    expect(warning?.severity).toBe('INFO')
  })
})

describe('buildHouseholdTeacherDashboard', () => {
  const content = makeValidCommonConditionsContent()

  const baseInput: Omit<BuildHouseholdTeacherDashboardInput, 'teams' | 'householdStates'> = {
    lessonRunId: 'run-1',
    courseFormat: 'COMMON_CONDITIONS',
    assignment: null,
    restoreGeneration: 0,
    synchronizedRoundIndex: null,
    roundStatus: null,
    content,
    decisions: {},
    lastSettlementEvents: {},
    checkpoints: [],
    activeBulkOperation: null,
    finalComparisonAvailable: false,
    nowMillis: 5000,
  }

  it('COMMON_CONDITIONS: 1 household per team, sets currentRoundIndex and householdsAligned=true when all households share roundIndex', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      teams: [
        { teamId: 'team-1', displayName: 'チーム1' },
        { teamId: 'team-2', displayName: 'チーム2' },
      ],
      householdStates: {
        'team-1': makeState({ householdId: 'team-1', teamId: 'team-1', roundIndex: 2 }),
        'team-2': makeState({ householdId: 'team-2', teamId: 'team-2', roundIndex: 2 }),
      },
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.currentRoundIndex).toBe(2)
    expect(dashboard.householdsAligned).toBe(true)
    expect(dashboard.teams).toHaveLength(2)
    for (const team of dashboard.teams) {
      expect(team.totalHouseholds).toBe(1)
      expect(team.households).toHaveLength(1)
      expect(team.households[0].householdId).toBe(team.teamId)
    }
  })

  it('COMMON_CONDITIONS: sets currentRoundIndex=null and householdsAligned=false when rounds differ, and misalignment warning is INFO (roundStatus null)', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      teams: [
        { teamId: 'team-1', displayName: 'チーム1' },
        { teamId: 'team-2', displayName: 'チーム2' },
      ],
      householdStates: {
        'team-1': makeState({ householdId: 'team-1', teamId: 'team-1', roundIndex: 1 }),
        'team-2': makeState({ householdId: 'team-2', teamId: 'team-2', roundIndex: 2 }),
      },
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.currentRoundIndex).toBeNull()
    expect(dashboard.householdsAligned).toBe(false)
    for (const team of dashboard.teams) {
      expect(team.warnings).toEqual([
        { severity: 'INFO', code: 'ROUND_MISALIGNED', message: expect.any(String) },
      ])
    }
  })

  it('COMMON regression: a single-household team wrapped in the new team structure carries the same underlying row data as the pre-Task-10 flat shape', () => {
    const state = makeState({ householdId: 'team-1', teamId: 'team-1', roundIndex: 3, cashYen: 12345, goalDelayedRounds: 2 })
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      teams: [{ teamId: 'team-1', displayName: 'チーム1' }],
      householdStates: { 'team-1': state },
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.teams).toHaveLength(1)
    const [team] = dashboard.teams
    expect(team.teamId).toBe('team-1')
    expect(team.teamDisplayName).toBe('チーム1')
    expect(team.totalHouseholds).toBe(1)
    expect(team.submittedCount).toBe(0)
    expect(team.allSubmitted).toBe(false)
    expect(team.households).toHaveLength(1)
    const [row] = team.households
    // Same per-household projection buildHouseholdTeacherRow always produced.
    expect(row.householdId).toBe('team-1')
    expect(row.teamId).toBe('team-1')
    expect(row.cashYen).toBe(12345)
    expect(row.roundIndex).toBe(3)
    expect(row.goalDelayedRounds).toBe(2)
    expect(row.warnings.map((w) => w.code)).toContain('GOAL_DELAYED')
  })

  it('ROLE_VARIANT / STAGE_SPLIT: 1 household per team, keyed by an opaque runtime householdId distinct from teamId', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      courseFormat: 'ROLE_VARIANT',
      teams: [
        { teamId: 'team-1', displayName: 'チーム1' },
        { teamId: 'team-2', displayName: 'チーム2' },
      ],
      householdStates: {
        'rt-household-a': makeState({ householdId: 'rt-household-a', teamId: 'team-1', profileId: 'profile-a', roundIndex: 1 }),
        'rt-household-b': makeState({ householdId: 'rt-household-b', teamId: 'team-2', profileId: 'profile-b', roundIndex: 1 }),
      },
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.teams).toHaveLength(2)
    const team1 = dashboard.teams.find((t) => t.teamId === 'team-1')!
    expect(team1.totalHouseholds).toBe(1)
    expect(team1.households[0].householdId).toBe('rt-household-a')
    expect(team1.households[0].teamId).toBe('team-1')

    const stageInput: BuildHouseholdTeacherDashboardInput = { ...input, courseFormat: 'STAGE_SPLIT' }
    const stageDashboard = buildHouseholdTeacherDashboard(stageInput)
    expect(stageDashboard.teams).toHaveLength(2)
    expect(stageDashboard.teams.every((t) => t.totalHouseholds === 1)).toBe(true)
  })

  it('MULTI_PERSON_PER_TEAM: many households per team, x/y submittedCount aggregation and allSubmitted', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teams: [{ teamId: 'team-1', displayName: 'チーム1' }],
      householdStates: {
        'rt-1': makeState({ householdId: 'rt-1', teamId: 'team-1', profileId: 'profile-1', roundIndex: 1 }),
        'rt-2': makeState({ householdId: 'rt-2', teamId: 'team-1', profileId: 'profile-2', roundIndex: 1 }),
        'rt-3': makeState({ householdId: 'rt-3', teamId: 'team-1', profileId: 'profile-3', roundIndex: 1 }),
        'rt-4': makeState({ householdId: 'rt-4', teamId: 'team-1', profileId: 'profile-4', roundIndex: 1 }),
      },
      decisions: {
        'rt-1': {
          decisionId: 'd-1', lessonRunId: 'run-1', householdId: 'rt-1', roundIndex: 1,
          assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
          shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'k-1', submittedAtServerMillis: 100,
        },
        'rt-2': {
          decisionId: 'd-2', lessonRunId: 'run-1', householdId: 'rt-2', roundIndex: 1,
          assetAllocationChangesYen: {}, insurancePurchaseIds: [], insuranceCancelIds: [],
          shortfallResolutionType: null, publicSupportApplicationIds: [], idempotencyKey: 'k-2', submittedAtServerMillis: 100,
        },
      },
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.teams).toHaveLength(1)
    const [team] = dashboard.teams
    expect(team.totalHouseholds).toBe(4)
    expect(team.submittedCount).toBe(2)
    expect(team.allSubmitted).toBe(false)

    // All 4 submitted -> allSubmitted true
    const allSubmittedInput: BuildHouseholdTeacherDashboardInput = {
      ...input,
      decisions: {
        'rt-1': input.decisions['rt-1'],
        'rt-2': input.decisions['rt-2'],
        'rt-3': { ...input.decisions['rt-1']!, decisionId: 'd-3', householdId: 'rt-3' },
        'rt-4': { ...input.decisions['rt-1']!, decisionId: 'd-4', householdId: 'rt-4' },
      },
    }
    const fullDashboard = buildHouseholdTeacherDashboard(allSubmittedInput)
    expect(fullDashboard.teams[0].submittedCount).toBe(4)
    expect(fullDashboard.teams[0].allSubmitted).toBe(true)
  })

  it('OPEN + misaligned across an advanced format is ACTION_REQUIRED at team level', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      roundStatus: 'OPEN',
      synchronizedRoundIndex: 1,
      teams: [{ teamId: 'team-1', displayName: 'チーム1' }],
      householdStates: {
        'rt-1': makeState({ householdId: 'rt-1', teamId: 'team-1', roundIndex: 1 }),
        'rt-2': makeState({ householdId: 'rt-2', teamId: 'team-1', roundIndex: 2 }),
      },
    }
    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.householdsAligned).toBe(false)
    expect(dashboard.teams[0].warnings).toEqual([
      { severity: 'ACTION_REQUIRED', code: 'ROUND_MISALIGNED', message: expect.any(String) },
    ])
  })

  it('SETTLING + misaligned across an advanced format is recoverable/INFO at team level', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      roundStatus: 'SETTLING',
      synchronizedRoundIndex: 1,
      teams: [{ teamId: 'team-1', displayName: 'チーム1' }],
      householdStates: {
        'rt-1': makeState({ householdId: 'rt-1', teamId: 'team-1', roundIndex: 1 }),
        'rt-2': makeState({ householdId: 'rt-2', teamId: 'team-1', roundIndex: 2 }),
      },
    }
    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.householdsAligned).toBe(false)
    expect(dashboard.teams[0].warnings).toEqual([
      { severity: 'INFO', code: 'ROUND_MISALIGNED', message: expect.any(String) },
    ])
  })

  it('maps active bulk operation errors to the correct household row by RUNTIME householdId, even within a multi-household team', () => {
    const activeBulkOperation: HouseholdBulkSettlementOperationView = {
      operationId: 'op-1',
      expectedRoundIndex: 1,
      forceUnsubmitted: false,
      status: 'FAILED',
      leaseActive: false,
      retryable: true,
      preSettlementCheckpointId: null,
      households: {
        'rt-1': { teamId: 'team-1', profileId: 'profile-1', status: 'FAILED', errorCode: 'E1', errorMessage: 'rt-1 のエラー' },
        'rt-2': { teamId: 'team-1', profileId: 'profile-2', status: 'SUCCEEDED' },
      },
      updatedAtServerMillis: 1000,
    }
    const input: BuildHouseholdTeacherDashboardInput = {
      ...baseInput,
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      teams: [{ teamId: 'team-1', displayName: 'チーム1' }],
      householdStates: {
        'rt-1': makeState({ householdId: 'rt-1', teamId: 'team-1', roundIndex: 1 }),
        'rt-2': makeState({ householdId: 'rt-2', teamId: 'team-1', roundIndex: 1 }),
      },
      activeBulkOperation,
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    const [team] = dashboard.teams
    const rt1 = team.households.find((h) => h.householdId === 'rt-1')!
    const rt2 = team.households.find((h) => h.householdId === 'rt-2')!
    expect(rt1.warnings.find((w) => w.code === 'BULK_SETTLEMENT_FAILED')?.message).toBe('rt-1 のエラー')
    expect(rt2.warnings.find((w) => w.code === 'BULK_SETTLEMENT_FAILED')).toBeUndefined()
  })
})
