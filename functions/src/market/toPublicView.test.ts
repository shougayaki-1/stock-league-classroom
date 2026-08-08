import { describe, expect, it } from 'vitest'
import type { EconomicIndicatorAuthoring, InformationItem, SimulatedCompany } from '@stock-league/market-authoring-content'
import { toCompanyPublicView, toEconomicIndicatorPublicView, toInformationPublicView } from './toPublicView'

const company: SimulatedCompany = {
  id: 'acme', name: 'アクメ商事', symbol: 'ACME', industry: '小売',
  description: '架空の総合小売企業', productsAndServices: ['日用品', 'EC'],
  domesticRevenueRatio: 0.7, overseasRevenueRatio: 0.3, costDrivers: ['物流費'],
  sizeClass: 'MEDIUM', financialStrength: 'STANDARD', growthProfile: 'STABLE',
  riskFactors: ['為替変動'], initialPrice: 1000,
  minimumPriceGuard: { type: 'ABSOLUTE', minimumPrice: 1 },
  impactSensitivities: { OFFICIAL_NEWS: 1.2, MARKET_DATA: 0.8 },
}

const info: InformationItem = {
  id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
  publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
  targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
  impact: { baseDirection: 'NEGATIVE', strength: 0.6, shortTermImpact: 0.4 },
}

const indicator: EconomicIndicatorAuthoring = {
  id: 'cpi-1', kind: 'PRICE', publishedAtMillis: 1000, label: '物価上昇',
  value: 2.1, changeFromPrevious: 0.3,
  companyImpactMultipliers: { acme: 1.1 },
}

describe('toCompanyPublicView', () => {
  it('drops impactSensitivities and minimumPriceGuard for the BASIC tier', () => {
    const view = toCompanyPublicView(company, 'BASIC')
    expect(view).not.toHaveProperty('impactSensitivities')
    expect(view).not.toHaveProperty('minimumPriceGuard')
    expect(view).not.toHaveProperty('financialStrength')
    expect(view.domesticRevenueRatio).toBeUndefined()
  })

  it('includes revenue mix at STANDARD but withholds financialStrength', () => {
    const view = toCompanyPublicView(company, 'STANDARD')
    expect(view.domesticRevenueRatio).toBe(0.7)
    expect(view).not.toHaveProperty('financialStrength')
  })

  it('includes financialStrength at ADVANCED, but never impactSensitivities', () => {
    const view = toCompanyPublicView(company, 'ADVANCED')
    expect(view.financialStrength).toBe('STANDARD')
    expect(view).not.toHaveProperty('impactSensitivities')
  })
})

describe('toInformationPublicView', () => {
  it('never leaks InformationImpact', () => {
    const view = toInformationPublicView(info)
    expect(view).not.toHaveProperty('impact')
    expect(view).toEqual({
      id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表',
      publishedAtMillis: 1000, natureType: 'FACT', confidenceLevel: 'HIGH',
      targetCompanyIds: ['acme'], body: '政府が新しい規制を発表した。',
    })
  })
})

describe('toEconomicIndicatorPublicView', () => {
  it('shows only the label at BASIC tier, dropping the multipliers', () => {
    const view = toEconomicIndicatorPublicView(indicator, 'BASIC')
    expect(view).not.toHaveProperty('companyImpactMultipliers')
    expect(view.value).toBeUndefined()
    expect(view.label).toBe('物価上昇')
  })

  it('includes value and changeFromPrevious at STANDARD, but never the multipliers', () => {
    const view = toEconomicIndicatorPublicView(indicator, 'STANDARD')
    expect(view.value).toBe(2.1)
    expect(view.changeFromPrevious).toBe(0.3)
    expect(view).not.toHaveProperty('companyImpactMultipliers')
  })
})
