import { describe, expect, it } from 'vitest'
import type { HomeEconomicsContent } from '@stock-league/household-authoring-content'
import { validateHomeEconomicsContent } from './templateValidation'

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
