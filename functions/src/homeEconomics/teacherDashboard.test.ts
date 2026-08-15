import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import type { HouseholdState } from '../lessonRuns/households/repository'
import {
  buildHouseholdTeacherDashboard,
  buildHouseholdTeacherRow,
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
      householdsAligned: true,
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
})

describe('buildHouseholdTeacherDashboard', () => {
  const content = makeValidCommonConditionsContent()

  it('sets currentRoundIndex and householdsAligned=true when all households share roundIndex', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      lessonRunId: 'run-1',
      restoreGeneration: 0,
      content,
      teams: [
        { teamId: 'team-1', displayName: 'チーム1' },
        { teamId: 'team-2', displayName: 'チーム2' },
      ],
      householdStates: {
        'team-1': {
          householdId: 'team-1', lessonRunId: 'run-1', teamId: 'team-1', profileId: 'team-1', cashYen: 100, assetHoldingsYen: {},
          activeInsuranceContracts: {}, activeLiabilities: {}, lifeStage: 'INDEPENDENT', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 0,
        },
        'team-2': {
          householdId: 'team-2', lessonRunId: 'run-1', teamId: 'team-2', profileId: 'team-2', cashYen: 100, assetHoldingsYen: {},
          activeInsuranceContracts: {}, activeLiabilities: {}, lifeStage: 'INDEPENDENT', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 0,
        },
      },
      decisions: {},
      lastSettlementEvents: {},
      checkpoints: [],
      activeBulkOperation: null,
      nowMillis: 5000,
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.currentRoundIndex).toBe(2)
    expect(dashboard.householdsAligned).toBe(true)
    expect(dashboard.households).toHaveLength(2)
  })

  it('sets currentRoundIndex=null and householdsAligned=false when rounds differ', () => {
    const input: BuildHouseholdTeacherDashboardInput = {
      lessonRunId: 'run-1',
      restoreGeneration: 0,
      content,
      teams: [
        { teamId: 'team-1', displayName: 'チーム1' },
        { teamId: 'team-2', displayName: 'チーム2' },
      ],
      householdStates: {
        'team-1': {
          householdId: 'team-1', lessonRunId: 'run-1', teamId: 'team-1', profileId: 'team-1', cashYen: 100, assetHoldingsYen: {},
          activeInsuranceContracts: {}, activeLiabilities: {}, lifeStage: 'INDEPENDENT', roundIndex: 1, goalDelayedRounds: 0, updatedAtServerMillis: 0,
        },
        'team-2': {
          householdId: 'team-2', lessonRunId: 'run-1', teamId: 'team-2', profileId: 'team-2', cashYen: 100, assetHoldingsYen: {},
          activeInsuranceContracts: {}, activeLiabilities: {}, lifeStage: 'INDEPENDENT', roundIndex: 2, goalDelayedRounds: 0, updatedAtServerMillis: 0,
        },
      },
      decisions: {},
      lastSettlementEvents: {},
      checkpoints: [],
      activeBulkOperation: null,
      nowMillis: 5000,
    }

    const dashboard = buildHouseholdTeacherDashboard(input)
    expect(dashboard.currentRoundIndex).toBeNull()
    expect(dashboard.householdsAligned).toBe(false)
  })
})
