import { describe, expect, it } from 'vitest'
import {
  formatCompanyFinancialStrength,
  formatCompanyGrowthProfile,
  formatCompanySize,
  formatEconomicIndicatorKind,
  formatInformationCategory,
  formatInformationConfidence,
  formatInformationNature,
  formatOrderSide,
  formatOrderStatus,
  formatResearchDeskPanel,
} from './marketLabels'

describe('market presentation labels', () => {
  it('maps the existing market/research semantic values', () => {
    expect(formatCompanySize('LARGE')).toBe('大型株')
    expect(formatCompanyGrowthProfile('GROWTH')).toBe('成長型')
    expect(formatCompanyFinancialStrength('STRONG')).toBe('強い')
    expect(formatInformationCategory('OFFICIAL_NEWS')).toBe('公式発表')
    expect(formatInformationNature('FORECAST')).toBe('予測')
    expect(formatInformationConfidence('HIGH')).toBe('確度: 高')
    expect(formatEconomicIndicatorKind('FX')).toBe('為替')
    expect(formatResearchDeskPanel('TEAM_NOTES')).toBe('チームノート')
    expect(formatOrderSide('BUY')).toBe('買い')
    expect(formatOrderStatus('FILLED')).toBe('約定済み')
  })

  it('never echoes an unknown market token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatCompanySize(raw),
      formatCompanyGrowthProfile(raw),
      formatCompanyFinancialStrength(raw),
      formatInformationCategory(raw),
      formatInformationNature(raw),
      formatInformationConfidence(raw),
      formatEconomicIndicatorKind(raw),
      formatResearchDeskPanel(raw),
      formatOrderSide(raw),
      formatOrderStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
