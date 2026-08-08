import { describe, expect, it } from 'vitest'
import type { EconomicIndicatorAuthoring, InformationImpact, InformationItem, SimulatedCompany } from './index'

describe('SimulatedCompany', () => {
  it('carries the hidden authoring fields the teacher UI edits', () => {
    const company: SimulatedCompany = {
      id: 'acme', name: 'アクメ商事', symbol: 'ACME', industry: '小売',
      description: '架空の総合小売企業', productsAndServices: ['日用品', 'EC'],
      domesticRevenueRatio: 0.7, overseasRevenueRatio: 0.3, costDrivers: ['物流費'],
      sizeClass: 'MEDIUM', financialStrength: 'STANDARD', growthProfile: 'STABLE',
      riskFactors: ['為替変動'], initialPrice: 1000,
      minimumPriceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
      impactSensitivities: { OFFICIAL_NEWS: 1.2, MARKET_DATA: 0.8 },
    }
    expect(company.impactSensitivities.OFFICIAL_NEWS).toBe(1.2)
    expect(company.minimumPriceGuard).toEqual({ type: 'ABSOLUTE', minimumPrice: 1 })
  })
})

describe('InformationItem', () => {
  it('carries the hidden InformationImpact alongside the public body', () => {
    const impact: InformationImpact = { baseDirection: 'NEGATIVE', strength: 0.6, shortTermImpact: 0.4 }
    const info: InformationItem = {
      id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
      publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
      targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
      impact,
    }
    expect(info.impact.baseDirection).toBe('NEGATIVE')
  })
})

describe('EconomicIndicatorAuthoring', () => {
  it('carries the hidden per-company multipliers', () => {
    const indicator: EconomicIndicatorAuthoring = {
      id: 'cpi-1', kind: 'PRICE', publishedAtMillis: 1000, label: '物価上昇',
      value: 2.1, changeFromPrevious: 0.3,
      companyImpactMultipliers: { acme: 1.1 },
    }
    expect(indicator.companyImpactMultipliers.acme).toBe(1.1)
  })
})
