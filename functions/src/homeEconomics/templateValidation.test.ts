import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { getHomeEconomicsContentWarnings, validateHomeEconomicsContent } from './templateValidation'

const baseContent = (overrides: Partial<HomeEconomicsContent> = {}): HomeEconomicsContent => ({
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
  ...overrides,
})

describe('validateHomeEconomicsContent', () => {
  it('accepts a well-formed minimal content', () => {
    expect(validateHomeEconomicsContent(baseContent())).toEqual({ valid: true })
  })

  it('rejects zero households (spec §13.2: at least one profile must exist)', () => {
    const result = validateHomeEconomicsContent(baseContent({ households: [] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('担当プロフィールが1件も設定されていません。')
  })

  it('rejects duplicate householdId values', () => {
    const dup = baseContent().households[0]
    const result = validateHomeEconomicsContent(baseContent({ households: [dup, { ...dup }] }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain(`プロフィールIDが重複しています: ${dup.householdId}`)
  })

  it('rejects evaluation weights that do not sum to 1 (spec §13.17)', () => {
    const result = validateHomeEconomicsContent(baseContent({
      evaluationWeights: {
        lifeGoalAchievement: 0.5, emergencyFundAdequacy: 0.5, stability: 0.5,
        diversification: 0, borrowingBurden: 0, reflection: 0,
      },
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('評価の重みの合計が1になっていません。')
  })

  it('rejects a life event referencing an unknown disclosure mode target (referential integrity, mirrors Task 2 in Phase C)', () => {
    const result = validateHomeEconomicsContent(baseContent({
      lifeEvents: [{ id: 'job-loss', label: '失業', disclosureMode: 'HIDDEN', triggerProbability: 1.5, effectDescription: 'x', incomeEffectYen: 0, expenseEffectYen: 0, cashEffectYen: 0 }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('イベント job-loss の発生確率は0〜1の範囲にしてください。')
  })
})

describe('COMMON_CONDITIONS course format requires exactly one shared household profile (spec §27.4 item 4)', () => {
  it('rejects COMMON_CONDITIONS with more than one household profile — teams must share identical initial conditions', () => {
    const two = baseContent().households[0]
    const result = validateHomeEconomicsContent(baseContent({
      courseFormat: 'COMMON_CONDITIONS', households: [two, { ...two, householdId: 'case-c' }],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('共通条件モードでは担当プロフィールを1件だけ設定してください。')
  })

  it('accepts ROLE_VARIANT with multiple household profiles', () => {
    const two = baseContent().households[0]
    const result = validateHomeEconomicsContent(baseContent({
      courseFormat: 'ROLE_VARIANT', households: [two, { ...two, householdId: 'case-c' }],
    }))
    expect(result.valid).toBe(true)
  })
})

describe('asset catalog must have at most one entry per assetType (Task 17: settleRound.computeAssetReturn resolves by assetType alone)', () => {
  it('rejects two asset catalog entries sharing the same assetType', () => {
    const result = validateHomeEconomicsContent(baseContent({
      assets: [
        { assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 5, volatilityPercent: 10 },
        { assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 3, volatilityPercent: 8 },
      ],
    }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors).toContain('資産カタログのassetTypeが重複しています: DOMESTIC_STOCK')
  })

  it('accepts distinct assetTypes in the asset catalog', () => {
    const result = validateHomeEconomicsContent(baseContent({
      assets: [
        { assetType: 'DOMESTIC_STOCK', valueYen: 0, expectedReturnPercent: 5, volatilityPercent: 10 },
        { assetType: 'FOREIGN_STOCK', valueYen: 0, expectedReturnPercent: 6, volatilityPercent: 12 },
      ],
    }))
    expect(result.valid).toBe(true)
  })
})

describe('getHomeEconomicsContentWarnings — advisory warnings (do not affect validateHomeEconomicsContent pass/fail)', () => {
  it('returns exactly one warning for ROLE_VARIANT with only one household profile', () => {
    const warnings = getHomeEconomicsContentWarnings(baseContent({ courseFormat: 'ROLE_VARIANT' }))
    expect(warnings).toHaveLength(1)
  })

  it('returns no warning for ROLE_VARIANT with multiple household profiles', () => {
    const one = baseContent().households[0]
    const warnings = getHomeEconomicsContentWarnings(baseContent({
      courseFormat: 'ROLE_VARIANT', households: [one, { ...one, householdId: 'case-c' }],
    }))
    expect(warnings).toHaveLength(0)
  })

  it('returns exactly one warning for STAGE_SPLIT with only one distinct lifeStage', () => {
    const one = baseContent().households[0]
    const warnings = getHomeEconomicsContentWarnings(baseContent({
      courseFormat: 'STAGE_SPLIT', households: [one, { ...one, householdId: 'case-c' }],
    }))
    expect(warnings).toHaveLength(1)
  })

  it('returns no warning for STAGE_SPLIT with multiple distinct lifeStages', () => {
    const one = baseContent().households[0]
    const warnings = getHomeEconomicsContentWarnings(baseContent({
      courseFormat: 'STAGE_SPLIT',
      households: [one, { ...one, householdId: 'case-c', lifeStage: 'RETIRED' }],
    }))
    expect(warnings).toHaveLength(0)
  })

  it('returns exactly one warning for MULTI_PERSON_PER_TEAM with only one household profile', () => {
    const warnings = getHomeEconomicsContentWarnings(baseContent({ courseFormat: 'MULTI_PERSON_PER_TEAM' }))
    expect(warnings).toHaveLength(1)
  })

  it('returns no warning for MULTI_PERSON_PER_TEAM with multiple household profiles', () => {
    const one = baseContent().households[0]
    const warnings = getHomeEconomicsContentWarnings(baseContent({
      courseFormat: 'MULTI_PERSON_PER_TEAM', households: [one, { ...one, householdId: 'case-c' }],
    }))
    expect(warnings).toHaveLength(0)
  })

  it('returns no warnings for COMMON_CONDITIONS content', () => {
    expect(getHomeEconomicsContentWarnings(baseContent())).toHaveLength(0)
  })

  it('does not change validateHomeEconomicsContent pass/fail behavior for content that would trigger warnings', () => {
    const result = validateHomeEconomicsContent(baseContent({ courseFormat: 'ROLE_VARIANT' }))
    expect(result.valid).toBe(true)
  })
})
