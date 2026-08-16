import { describe, expect, it } from 'vitest'
import type {
  AssetPositionPublicView,
  HouseholdClassComparisonHouseholdView,
  HouseholdClassComparisonPublicView,
  HouseholdProfilePublicView,
} from './index'

describe('HouseholdProfilePublicView', () => {
  it('carries only the 7 core profile fields (spec §13.4), never authoring-only internals', () => {
    const view: HouseholdProfilePublicView = {
      householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
      annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
      family: '配偶者・子2人', housing: '賃貸マンション',
      lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
      isFictional: true,
    }
    expect(Object.keys(view)).not.toContain('eventProbabilityOverrides')
    expect(Object.keys(view)).not.toContain('internalRiskFactors')
  })
})

describe('AssetPositionPublicView', () => {
  it('never carries the internal expected-return/volatility coefficients', () => {
    const view: AssetPositionPublicView = {
      assetType: 'DOMESTIC_STOCK', valueYen: 500000,
    }
    expect(Object.keys(view)).not.toContain('expectedReturnPercent')
    expect(Object.keys(view)).not.toContain('volatilityPercent')
  })
})

describe('HouseholdClassComparisonHouseholdView (Task 12)', () => {
  it('carries only the logical profileId + allow-listed household fields — no runtime householdId, no participant identity, no risk/probability/seed fields', () => {
    const householdView: HouseholdClassComparisonHouseholdView = {
      profileId: 'profile-a',
      profile: {
        householdId: 'profile-a', age: 32, householdIncomeYen: 6000000,
        annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
        family: '配偶者・子2人', housing: '賃貸マンション',
        lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
        isFictional: true,
      },
      cashYen: 1200000,
      totalAssetsYen: 3400000,
      totalLiabilitiesYen: 500000,
      goalDelayedRounds: 1,
      lifeGoalAchievementScore: 80,
    }

    const serialized = JSON.stringify(householdView)
    for (const forbidden of [
      'runtimeHouseholdId', 'participantId', 'uid', 'displayName', 'studentName',
      'internalRiskFactors', 'eventProbabilityOverrides',
      'claimProbability', 'randomSeed', 'seed',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(Object.keys(householdView)).not.toContain('householdId')
  })
})

describe('HouseholdClassComparisonPublicView (Task 12)', () => {
  it('groups households under team display names only — never a teamId-keyed map of runtime household ids', () => {
    const view: HouseholdClassComparisonPublicView = {
      courseFormat: 'ROLE_VARIANT',
      finalRoundCount: 6,
      publishedAtMillis: 1_700_000_000_000,
      teams: [{ teamDisplayName: 'チームA', households: [] }],
    }
    expect(view.teams[0].teamDisplayName).toBe('チームA')
    expect(Object.keys(view.teams[0])).not.toContain('teamId')
  })
})
