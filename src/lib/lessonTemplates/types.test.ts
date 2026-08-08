import { describe, expect, it } from 'vitest'
import type { LessonContent, SocialStudiesMarketContent } from './types'

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
