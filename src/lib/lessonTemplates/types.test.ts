import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent, LessonContent, SocialStudiesMarketContent } from './types'

describe('SocialStudiesMarketContent defaults', () => {
  it('encodes every §28 default value as a field default, not scattered in code', () => {
    const content: SocialStudiesMarketContent = {
      companies: [], informationItems: [], economicIndicators: [],
      batchIntervalSeconds: 3,
      priceSensitivityPreset: 'BALANCED',
      marketNoiseEnabled: true,
      resumeConfirmationSeconds: 30,
      companyDifficultyTier: 'STANDARD',
      indicatorDifficultyTier: 'STANDARD',
      tradingFeeYen: 0,
      dividendEnabled: false,
      stockSplitEnabled: false,
      bankruptcyEnabled: false,
      dividendTriggerBatchIndexes: [],
      stockSplitTriggerBatchIndexes: [],
      dividendPerShareYen: 0,
      stockSplitRatio: 1,
      predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
      evaluationWeights: {
        operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4,
        riskManagement: 0.1, reflection: 0.1,
      },
    }
    expect(content.batchIntervalSeconds).toBe(3)
    expect(content.resumeConfirmationSeconds).toBe(30)
    expect(content.tradingFeeYen).toBe(0)
  })

  it('LessonContent.socialStudiesMarket is optional so HOME_ECONOMICS content is unaffected', () => {
    const content: LessonContent = { schemaVersion: 1, title: 't', description: '', subject: 'HOME_ECONOMICS' }
    expect(content.socialStudiesMarket).toBeUndefined()
  })
})

describe('HomeEconomicsContent defaults', () => {
  it('encodes every §28-equivalent default value as a field default, not scattered in code', () => {
    const content: HomeEconomicsContent = {
      households: [{
        householdId: 'case-b', age: 32, householdIncomeYen: 6000000,
        annualLivingExpensesYen: 3000000, cashSavingsYen: 2000000,
        family: '配偶者・子2人', housing: '賃貸マンション',
        lifeGoal: '住宅購入と教育資金', lifeStage: 'CHILD_REARING',
        eventProbabilityOverrides: {}, internalRiskFactors: {},
      }],
      assets: [], insuranceProducts: [], lifeEvents: [], liabilities: [], publicSupportPrograms: [],
      roundYears: 5, courseFormat: 'COMMON_CONDITIONS',
      taxAndSocialInsuranceModelVersion: 1,
      economicFactors: { inflationPercent: 1, interestRatePercent: 1, marketReturnPercent: 3 },
      borrowingAllowed: false,
      goalPackage: 'EMERGENCY_FUND',
      evaluationWeights: {
        lifeGoalAchievement: 0.2, emergencyFundAdequacy: 0.15, stability: 0.2,
        diversification: 0.15, borrowingBurden: 0.15, reflection: 0.15,
      },
    }
    expect(content.roundYears).toBe(5)
    expect(content.taxAndSocialInsuranceModelVersion).toBe(1)
  })
})

describe('LessonContent.homeEconomics', () => {
  it('is optional so SOCIAL_STUDIES content is unaffected', () => {
    const content: LessonContent = { schemaVersion: 1, title: 't', description: '', subject: 'SOCIAL_STUDIES' }
    expect(content.homeEconomics).toBeUndefined()
  })
})
