import { describe, expect, it, vi } from 'vitest'
import type { SocialStudiesMarketContent } from '@stock-league/market-authoring-content'
import {
  buildResearchDeskPublicView,
  publishResearchDeskProjection,
} from './researchDeskProjection'

const fixtureMarketContent: SocialStudiesMarketContent = {
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
    operationResult: 0.3,
    predictionAccuracy: 0.2,
    informationUsage: 0.2,
    riskManagement: 0.15,
    reflection: 0.15,
  },
  companies: [
    {
      id: 'comp-1',
      name: 'Sample Tech',
      symbol: '1001',
      industry: 'Technology',
      description: 'A tech company',
      productsAndServices: ['Cloud Software'],
      domesticRevenueRatio: 0.6,
      overseasRevenueRatio: 0.4,
      costDrivers: ['Server costs'],
      sizeClass: 'LARGE',
      financialStrength: 'STRONG',
      growthProfile: 'GROWTH',
      riskFactors: ['Cyber risks'],
      initialPrice: 1000,
      minimumPriceGuard: { type: 'ABSOLUTE', minimumPrice: 100 },
      impactSensitivities: { OFFICIAL_NEWS: 1.2 },
    },
  ],
  informationItems: [
    {
      id: 'info-past',
      category: 'OFFICIAL_NEWS',
      source: 'Nikkei',
      publishedAtMillis: 1_000,
      natureType: 'FACT',
      confidenceLevel: 'HIGH',
      targetCompanyIds: ['comp-1'],
      body: 'Quarterly profits up 20%',
      impact: { baseDirection: 'POSITIVE', strength: 1.5 },
    },
    {
      id: 'info-future',
      category: 'EARNINGS',
      source: 'Rumor',
      publishedAtMillis: 2_000,
      natureType: 'FORECAST',
      confidenceLevel: 'MEDIUM',
      targetCompanyIds: ['comp-1'],
      body: 'Future announcement',
      impact: { baseDirection: 'NEGATIVE', strength: 1.0 },
    },
  ],
  economicIndicators: [
    {
      id: 'ind-past',
      kind: 'FX',
      publishedAtMillis: 1_000,
      label: '円安進行',
      value: 155.5,
      changeFromPrevious: 1.2,
      companyImpactMultipliers: { 'comp-1': 1.1 },
    },
    {
      id: 'ind-future',
      kind: 'INTEREST_RATE',
      publishedAtMillis: 2_000,
      label: '利上げ',
      value: 0.5,
      changeFromPrevious: 0.25,
      companyImpactMultipliers: { 'comp-1': 0.9 },
    },
  ],
}

describe('buildResearchDeskPublicView', () => {
  const phases = [
    { id: 'p-intro', phaseType: 'INTRO' },
    { id: 'p-info', phaseType: 'INFORMATION' },
    { id: 'p-pred', phaseType: 'PREDICTION' },
    { id: 'p-disc', phaseType: 'DISCUSSION' },
    { id: 'p-mkt', phaseType: 'MARKET' },
    { id: 'p-dec', phaseType: 'DECISION' },
    { id: 'p-res', phaseType: 'RESULT' },
    { id: 'p-ref', phaseType: 'REFLECTION' },
    { id: 'p-custom', phaseType: 'CUSTOM' },
  ]

  it('returns empty availablePanels and empty data arrays for INTRO phase', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-intro',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 1_500,
    })
    expect(view.phaseId).toBe('p-intro')
    expect(view.phaseType).toBe('INTRO')
    expect(view.availablePanels).toEqual([])
    expect(view.companies).toEqual([])
    expect(view.informationItems).toEqual([])
    expect(view.economicIndicators).toEqual([])
    expect(view.updatedAtMillis).toBe(1_500)
  })

  it('returns 3 panels for INFORMATION phase and populates published items', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-info',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 1_500,
    })
    expect(view.availablePanels).toEqual(['COMPANIES', 'NEWS', 'STATISTICS'])
    expect(view.companies).toHaveLength(1)
    expect(view.companies[0].id).toBe('comp-1')
    expect(view.informationItems).toHaveLength(1)
    expect(view.informationItems[0].id).toBe('info-past')
    expect(view.economicIndicators).toHaveLength(1)
    expect(view.economicIndicators[0].id).toBe('ind-past')
  })

  it('returns 4 panels for PREDICTION, DISCUSSION, DECISION, RESULT, REFLECTION phases', () => {
    for (const phaseId of ['p-pred', 'p-disc', 'p-dec', 'p-res', 'p-ref']) {
      const view = buildResearchDeskPublicView({
        phaseId,
        phases,
        socialStudiesMarket: fixtureMarketContent,
        nowMillis: 1_500,
      })
      expect(view.availablePanels).toEqual(['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES'])
    }
  })

  it('returns 5 panels for MARKET phase', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-mkt',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 1_500,
    })
    expect(view.availablePanels).toEqual(['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES', 'ORDERS'])
  })

  it('returns empty availablePanels for CUSTOM phase', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-custom',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 1_500,
    })
    expect(view.availablePanels).toEqual([])
    expect(view.companies).toEqual([])
    expect(view.informationItems).toEqual([])
    expect(view.economicIndicators).toEqual([])
  })

  it('excludes future items (publishedAtMillis > nowMillis) from informationItems and economicIndicators', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-info',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 1_000,
    })
    // At nowMillis = 1000, info-past (1000) and ind-past (1000) are included; future (2000) is excluded
    expect(view.informationItems.map((i) => i.id)).toEqual(['info-past'])
    expect(view.economicIndicators.map((i) => i.id)).toEqual(['ind-past'])

    const viewFuture = buildResearchDeskPublicView({
      phaseId: 'p-info',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 2_000,
    })
    expect(viewFuture.informationItems.map((i) => i.id)).toEqual(['info-past', 'info-future'])
    expect(viewFuture.economicIndicators.map((i) => i.id)).toEqual(['ind-past', 'ind-future'])
  })

  it('does NOT contain hidden authoring fields in serialized output', () => {
    const view = buildResearchDeskPublicView({
      phaseId: 'p-mkt',
      phases,
      socialStudiesMarket: fixtureMarketContent,
      nowMillis: 2_000,
    })
    const jsonStr = JSON.stringify(view)
    expect(jsonStr).not.toContain('impactSensitivities')
    expect(jsonStr).not.toContain('minimumPriceGuard')
    expect(jsonStr).not.toContain('companyImpactMultipliers')
    expect(jsonStr).not.toContain('baseDirection')
    expect(jsonStr).not.toContain('batchIntervalSeconds')
  })
})

describe('publishResearchDeskProjection', () => {
  it('updates lessonRunPublic with researchDesk key only', async () => {
    const updatePublicFn = vi.fn().mockResolvedValue(undefined)
    const getRunFn = vi.fn().mockResolvedValue({
      currentPhaseId: 'p-mkt',
      templateSnapshot: {
        phases: [{ id: 'p-mkt', phaseType: 'MARKET' }],
        socialStudiesMarket: fixtureMarketContent,
      },
    })

    await publishResearchDeskProjection({
      getLessonRun: getRunFn,
      updateLessonRunPublic: updatePublicFn,
      now: () => 5_000,
    }, 'run-123')

    expect(getRunFn).toHaveBeenCalledWith('run-123')
    expect(updatePublicFn).toHaveBeenCalledTimes(1)
    expect(updatePublicFn).toHaveBeenCalledWith('run-123', {
      researchDesk: expect.objectContaining({
        phaseId: 'p-mkt',
        phaseType: 'MARKET',
        availablePanels: ['COMPANIES', 'NEWS', 'STATISTICS', 'TEAM_NOTES', 'ORDERS'],
        updatedAtMillis: 5_000,
      }),
    })
  })
})
