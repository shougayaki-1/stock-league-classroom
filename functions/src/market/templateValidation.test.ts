import { describe, expect, it } from 'vitest'
import { validateSocialStudiesMarketContent } from './templateValidation'
import type { SocialStudiesMarketContent } from '@stock-league/market-authoring-content'

const validCompany = (id: string) => ({
  id, name: id, symbol: id.toUpperCase(), industry: '小売', description: '説明',
  productsAndServices: ['商品'], costDrivers: ['費用'], sizeClass: 'MEDIUM' as const,
  financialStrength: 'STANDARD' as const, growthProfile: 'STABLE' as const,
  riskFactors: ['リスク'], initialPrice: 1000,
  minimumPriceGuard: { type: 'ABSOLUTE' as const, minimumPrice: 1 },
  impactSensitivities: {},
})

const baseContent = (overrides: Partial<SocialStudiesMarketContent> = {}): SocialStudiesMarketContent => ({
  companies: [validCompany('acme'), validCompany('globex'), validCompany('initech')],
  informationItems: [], economicIndicators: [],
  batchIntervalSeconds: 3, priceSensitivityPreset: 'BALANCED', marketNoiseEnabled: true,
  resumeConfirmationSeconds: 30, companyDifficultyTier: 'STANDARD', indicatorDifficultyTier: 'STANDARD',
  tradingFeeYen: 0, dividendEnabled: false, stockSplitEnabled: false, bankruptcyEnabled: false,
  predictionEvaluationTarget: { type: 'AFTER_BATCHES', count: 20 },
  evaluationWeights: { operationResult: 0.1, predictionAccuracy: 0.3, informationUsage: 0.4, riskManagement: 0.1, reflection: 0.1 },
  ...overrides,
})

describe('validateSocialStudiesMarketContent', () => {
  it('accepts a valid 3-company draft (spec §12.4 minimum for a 50-minute lesson)', () => {
    expect(validateSocialStudiesMarketContent(baseContent())).toEqual({ valid: true })
  })

  it('rejects fewer than 3 companies', () => {
    const result = validateSocialStudiesMarketContent(baseContent({ companies: [validCompany('acme')] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('企業は3社以上必要です。')
  })

  it('rejects more than 6 companies (spec §12.4 standard upper bound)', () => {
    const companies = Array.from({ length: 7 }, (_, i) => validCompany(`c${i}`))
    const result = validateSocialStudiesMarketContent(baseContent({ companies }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('企業は6社以下にしてください。')
  })

  it('rejects duplicate symbols', () => {
    const result = validateSocialStudiesMarketContent(
      baseContent({ companies: [validCompany('acme'), { ...validCompany('globex'), symbol: 'ACME' }, validCompany('initech')] }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('銘柄コードが重複しています: ACME')
  })

  it('rejects batchIntervalSeconds outside the 1-10 range (spec §12.9)', () => {
    const result = validateSocialStudiesMarketContent(baseContent({ batchIntervalSeconds: 11 }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('処理間隔は1〜10秒にしてください。')
  })

  it('rejects an information item referencing an unknown company id', () => {
    const result = validateSocialStudiesMarketContent(baseContent({
      informationItems: [{
        id: 'news-1', category: 'OFFICIAL_NEWS', source: '政府発表', publishedAtMillis: 0,
        natureType: 'FACT', confidenceLevel: 'HIGH', targetCompanyIds: ['does-not-exist'],
        body: '本文', impact: { baseDirection: 'NEUTRAL', strength: 0 },
      }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('情報 news-1 が存在しない企業を参照しています: does-not-exist')
  })

  it('rejects evaluationWeights that do not sum to 1 (spec §12.33)', () => {
    const result = validateSocialStudiesMarketContent(baseContent({
      evaluationWeights: { operationResult: 0.5, predictionAccuracy: 0.5, informationUsage: 0.5, riskManagement: 0, reflection: 0 },
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('評価の重みの合計は1にしてください（現在: 1.5）。')
  })
})
