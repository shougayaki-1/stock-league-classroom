import { describe, expect, it } from 'vitest'
import {
  formatHouseholdAssetType,
  formatHouseholdConcept,
  formatHouseholdCourseFormat,
  formatHouseholdGoalPackage,
  formatHouseholdLiabilityKind,
  formatHouseholdLifeStage,
  formatHouseholdRoundStatus,
} from './householdLabels'

describe('home economics presentation labels', () => {
  it('maps semantic household values to Japanese product language', () => {
    expect(formatHouseholdLifeStage('CHILD_REARING')).toBe('子育て期')
    expect(formatHouseholdAssetType('DOMESTIC_STOCK')).toBe('国内株式')
    expect(formatHouseholdCourseFormat('COMMON_CONDITIONS')).toBe('共通条件')
    expect(formatHouseholdLiabilityKind('MORTGAGE')).toBe('住宅ローン')
    expect(formatHouseholdGoalPackage('RETIREMENT_PREP')).toBe('退職準備')
    expect(formatHouseholdConcept('ASSET_DIVERSIFICATION')).toBe('資産分散')
    expect(formatHouseholdRoundStatus('SETTLING')).toBe('集計中')
  })

  it('never echoes an unknown household token', () => {
    const raw = 'UNKNOWN_INTERNAL_TOKEN'
    const results = [
      formatHouseholdLifeStage(raw),
      formatHouseholdAssetType(raw),
      formatHouseholdCourseFormat(raw),
      formatHouseholdLiabilityKind(raw),
      formatHouseholdGoalPackage(raw),
      formatHouseholdConcept(raw),
      formatHouseholdRoundStatus(raw),
    ]

    for (const result of results) expect(result).not.toContain(raw)
  })
})
