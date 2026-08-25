import { describe, expect, it } from 'vitest'
import {
  formatHouseholdAssetType,
  formatHouseholdAssignmentState,
  formatHouseholdAssignmentValidationStatus,
  formatHouseholdConcept,
  formatHouseholdCourseFormat,
  formatHouseholdGoalPackage,
  formatHouseholdLiabilityKind,
  formatHouseholdLifeStage,
  formatHouseholdProfileLabel,
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

  it('formats a household profile from translated stage plus authored family text', () => {
    expect(formatHouseholdProfileLabel('CHILD_REARING', ' 配偶者・子1人 '))
      .toBe('子育て期・配偶者・子1人')
  })

  it('fails closed when profile semantics are entirely missing', () => {
    expect(formatHouseholdProfileLabel(undefined, undefined))
      .toBe('家庭プロフィールを確認できません')
  })

  it('never echoes an unknown life-stage token', () => {
    const value = formatHouseholdProfileLabel('UNKNOWN_INTERNAL_STAGE', '単身')
    expect(value).toBe('ライフステージを確認できません・単身')
    expect(value).not.toContain('UNKNOWN_INTERNAL_STAGE')
  })

  it('fails closed for assignment state and validation status', () => {
    expect(formatHouseholdAssignmentState('BACKEND_ONLY_STATE'))
      .toBe('割り当て状態を確認できません')
    expect(formatHouseholdAssignmentValidationStatus('RAW_VALIDATION_TOKEN'))
      .toBe('検証状況を確認できません')
  })
})
