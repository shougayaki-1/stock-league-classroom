import { describe, expect, it } from 'vitest'
import type {
  AdvancedHouseholdTeamStateView,
  HouseholdClassComparisonPublicView,
  LessonRunPrivateState,
  LessonRunPublicState,
  LessonRunTeamState,
} from './liveTypes'

describe('LessonRunPublicState / LessonRunPrivateState field separation', () => {
  it('LessonRunPublicState has no field named randomSeed or containing "seed"', () => {
    const publicKeys: (keyof LessonRunPublicState)[] = ['status', 'currentPhaseId', 'updatedAtMillis']
    expect(publicKeys.some((key) => key.toLowerCase().includes('seed'))).toBe(false)
  })
  it('LessonRunPrivateState carries randomSeed', () => {
    const privateKeys: (keyof LessonRunPrivateState)[] = ['randomSeed', 'restoreGeneration', 'updatedAtMillis']
    expect(privateKeys).toContain('randomSeed')
  })

  it('LessonRunPublicState carries per-stock price/breakdown but never a coefficient or seed', () => {
    const state: LessonRunPublicState = {
      status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1,
      orgId: 'personal_teacher-a', currentPhaseLabel: null, currentPhaseEndsAtMillis: null, publicTask: null, notifications: [],
      title: '株式投資シミュレーション', teams: [],
      marketPaused: false, nextBatchAtMillis: 1003000,
      stocks: {
        acme: {
          currentPrice: 1030, previousPrice: 1000, guardApplied: false, suddenChangeWarning: false,
          breakdown: { informationPercent: 2.1, demandPercent: 0.8, otherPercent: 0.1, total: 3.0 },
          displayedVolumeShares: 42,
        },
      },
    }
    expect(Object.keys(state)).not.toContain('randomSeed')
    expect(Object.keys(state.stocks.acme.breakdown)).toEqual(['informationPercent', 'demandPercent', 'otherPercent', 'total'])
  })

  it('LessonRunPrivateState carries a per-stock computationLog never sent to students', () => {
    const state: LessonRunPrivateState = {
      randomSeed: 'seed-1', restoreGeneration: 1, updatedAtMillis: 1, lastProcessedBatchId: 'batch-1',
      computationLog: {
        acme: { informationImpactPercent: 2.1, demandImpactPercent: 0.8, noisePercent: 0.1, priceSensitivityPreset: 'MEDIUM' },
      },
    }
    expect(state.computationLog.acme.priceSensitivityPreset).toBe('MEDIUM')
  })

  it('LessonRunTeamState is a type distinct from public/private state — its own visibility class', () => {
    const state: LessonRunTeamState = {
      cash: 14000, holdings: { acme: 3 }, lockedBuyValue: 6000, lockedSellQuantity: {},
      myOrders: [{ orderId: 'o1', stockId: 'acme', side: 'BUY', quantity: 5, status: 'PENDING', referencePrice: 1000 }],
      updatedAtMillis: 1,
    }
    expect(state.cash).toBe(14000)
  })

  it('LessonRunTeamState carries AdvancedHouseholdTeamStateView fields flat on the node (Task 9), not nested under a wrapper key', () => {
    const view: AdvancedHouseholdTeamStateView = {
      courseFormat: 'MULTI_PERSON_PER_TEAM',
      synchronizedRoundIndex: 2,
      roundStatus: 'OPEN',
      households: {
        'household-a': {
          householdId: 'household-a',
          profile: {
            householdId: 'profile-a', age: 30, householdIncomeYen: 5000000, annualLivingExpensesYen: 3000000,
            cashSavingsYen: 1000000, family: '独身', housing: '賃貸', lifeGoal: '貯蓄', lifeStage: 'INDEPENDENT',
            isFictional: true,
          },
          state: {
            householdId: 'household-a', isFictional: true, cashYen: 100000, assetHoldingsYen: {},
            activeInsuranceContractYearsRemaining: {}, activeLiabilities: {}, lifeStage: 'INDEPENDENT',
            roundIndex: 2, goalDelayedRounds: 0, visibleConcepts: [], eventDisclosures: [], shortfallOptions: [],
            profileSummary: { lifeStage: 'INDEPENDENT', family: '独身' },
          },
          submittedRoundIndex: null,
        },
      },
      householdOrder: ['household-a'],
    }
    const state: LessonRunTeamState = {
      cash: 0, holdings: {}, lockedBuyValue: 0, lockedSellQuantity: {}, myOrders: [], updatedAtMillis: 1,
      ...view,
    }
    expect(state.courseFormat).toBe('MULTI_PERSON_PER_TEAM')
    expect(state.households?.['household-a'].submittedRoundIndex).toBeNull()
    expect(state.household).toBeUndefined()
  })

  it('LessonRunPublicState.householdClassComparison is optional and absent by default (market lesson)', () => {
    const state: LessonRunPublicState = {
      status: 'RUNNING', currentPhaseId: 'phase-1', updatedAtMillis: 1,
      orgId: 'personal_teacher-a', currentPhaseLabel: null, currentPhaseEndsAtMillis: null, publicTask: null, notifications: [],
      title: '株式投資シミュレーション', teams: [],
      marketPaused: false, nextBatchAtMillis: null, stocks: {},
    }
    expect(state.householdClassComparison).toBeUndefined()
  })

  it('LessonRunPublicState.householdClassComparison (Task 12), when present, carries only profileId + allow-listed household fields under team display names', () => {
    const comparison: HouseholdClassComparisonPublicView = {
      courseFormat: 'ROLE_VARIANT',
      finalRoundCount: 6,
      publishedAtMillis: 1_700_000_000_000,
      teams: [{
        teamDisplayName: 'チームA',
        households: [{
          profileId: 'profile-a',
          profile: {
            householdId: 'profile-a', age: 32, householdIncomeYen: 6000000, annualLivingExpensesYen: 3000000,
            cashSavingsYen: 2000000, family: '配偶者・子2人', housing: '賃貸マンション',
            lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING', isFictional: true,
          },
          cashYen: 1200000, totalAssetsYen: 3400000, totalLiabilitiesYen: 500000,
          goalDelayedRounds: 1, lifeGoalAchievementScore: 80,
        }],
      }],
    }
    const state: LessonRunPublicState = {
      status: 'REFLECTION', currentPhaseId: 'phase-1', updatedAtMillis: 1,
      orgId: 'personal_teacher-a', currentPhaseLabel: null, currentPhaseEndsAtMillis: null, publicTask: null, notifications: [],
      title: '家庭科シミュレーション', teams: [],
      marketPaused: false, nextBatchAtMillis: null, stocks: {},
      householdClassComparison: comparison,
    }
    expect(state.householdClassComparison?.teams[0].teamDisplayName).toBe('チームA')
    expect(Object.keys(state.householdClassComparison!.teams[0].households[0])).not.toContain('householdId')
    expect(JSON.stringify(state.householdClassComparison)).not.toContain('internalRiskFactors')
  })
})
